#!/usr/bin/env python3
"""DPA bridge for Linux and macOS (Raspberry Pi, laptop): the same job as Bridge.cs on the Surface.

Serves the app's static files on http://<host>:<port>/ and passes bytes between a WebSocket at /ws and the
unit's serial port. One WebSocket client at a time; the serial port is open only while a client is connected.
Safety: frames from the client are checked (forbidden commands, 0x17 at 0x2000+); if the client leaves after a
connect (0x00) without a disconnect (0x0f), the bridge sends the disconnect itself.

Python standard library only, so a fresh Raspberry Pi OS needs nothing installed.
Run: bridge.py <webroot> [port=8240] [serial=/dev/ttyUSB0] [baud=9600] [host=0.0.0.0]
"""
import asyncio
import base64
import hashlib
import json
import os
import struct
import sys
import termios
import time
from urllib.parse import unquote, urlsplit

FORBIDDEN = {0x28, 0x18, 0x10, 0x24}
ALLOWED = {0x00, 0x0F, 0x01, 0x02, 0x03, 0x04, 0x05, 0x07, 0x08, 0x09, 0x17}
MIME = {
    ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8", ".json": "application/json", ".webmanifest": "application/json",
    ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon",
}
BAUDS = {9600: termios.B9600, 19200: termios.B19200, 38400: termios.B38400, 57600: termios.B57600, 115200: termios.B115200}
CLIENT_SILENCE_S = 30  # clients send "ping" every 10 s; one silent this long is gone
WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"


def check(f: bytes):
    """Reason a frame is refused, or None. Same rules as Bridge.cs."""
    if len(f) != 13 or f[0] != 0xF0 or f[12] != 0xF7:
        return "not a 13-byte frame"
    if f[1] != 0xC1 or f[2] != 0:
        return "model id / device byte refused"
    c = f[3]
    if c in FORBIDDEN or c not in ALLOWED:
        return "command 0x%02x refused" % c
    if c == 0x17 and ((f[4] << 8) | f[5]) >= 0x2000:
        return "read at 0x2000+ refused"
    if c not in (0x00, 0x0F, 0x17) and f[4] > 5:
        return "channel byte refused"
    return None


def open_serial(path: str, baud: int) -> int:
    """Open raw 8N1, no flow control, DTR/RTS left low where the driver allows it. Returns a file descriptor."""
    fd = os.open(path, os.O_RDWR | os.O_NOCTTY | os.O_NONBLOCK)
    try:
        a = termios.tcgetattr(fd)
        a[0] = 0                                             # iflag: no translation, no software flow control
        a[1] = 0                                             # oflag: raw
        a[2] = termios.CS8 | termios.CREAD | termios.CLOCAL  # cflag: 8N1, ignore modem lines, no HUPCL, no RTS/CTS
        a[3] = 0                                             # lflag: raw
        a[4] = a[5] = BAUDS[baud]
        a[6][termios.VMIN] = 0
        a[6][termios.VTIME] = 0
        termios.tcsetattr(fd, termios.TCSANOW, a)
        try:  # drop DTR and RTS (the unit was decoded with both off); not every driver or pty supports this
            import fcntl
            bits = struct.pack("I", termios.TIOCM_DTR | termios.TIOCM_RTS)
            fcntl.ioctl(fd, termios.TIOCMBIC, bits)
        except OSError:
            pass
        termios.tcflush(fd, termios.TCIOFLUSH)
    except Exception:
        os.close(fd)
        raise
    return fd


class Bridge:
    def __init__(self, root, port, serial, baud, host):
        self.root = os.path.realpath(root)
        self.port, self.serial, self.baud, self.host = port, serial, baud, host
        self.busy = False
        self.log_path = os.path.join(os.path.dirname(self.root), "bridge.log")

    def log(self, s):
        line = time.strftime("%Y-%m-%d %H:%M:%S ") + s
        print(line, flush=True)
        try:
            with open(self.log_path, "a") as f:
                f.write(line + "\n")
        except OSError:
            pass

    async def run(self):
        srv = await asyncio.start_server(self.handle, self.host, self.port)
        self.log("listening on %s:%d root %s serial %s %d" % (self.host, self.port, self.root, self.serial, self.baud))
        async with srv:
            await srv.serve_forever()

    # ---- HTTP -------------------------------------------------------------------------------------------
    async def handle(self, r: asyncio.StreamReader, w: asyncio.StreamWriter):
        try:
            head = await asyncio.wait_for(r.readuntil(b"\r\n\r\n"), 10)
            lines = head.decode("latin1").split("\r\n")
            parts = lines[0].split(" ")
            if len(parts) < 2:
                return
            path = urlsplit(parts[1]).path
            hdr = {k.strip().lower(): v.strip() for k, v in (l.split(":", 1) for l in lines[1:] if ":" in l)}
            if path == "/ws" and hdr.get("upgrade", "").lower() == "websocket":
                await self.ws(r, w, hdr)
            elif path == "/api/status":
                self.send(w, 200, "application/json", json.dumps({"serial": self.serial, "busy": self.busy}).encode())
            else:
                self.static(w, path)
            await w.drain()
        except (asyncio.IncompleteReadError, asyncio.TimeoutError, ConnectionError, asyncio.LimitOverrunError):
            pass
        except Exception as e:  # never let one request end the server
            self.log("handler error %r" % e)
        finally:
            try:
                w.close()
            except Exception:
                pass

    def static(self, w, path):
        if path == "/":
            path = "/index.html"
        file = os.path.realpath(os.path.join(self.root, unquote(path).lstrip("/")))
        if not (file == self.root or file.startswith(self.root + os.sep)) or not os.path.isfile(file):
            self.send(w, 404, "text/plain", b"not found")
            return
        with open(file, "rb") as f:
            body = f.read()
        self.send(w, 200, MIME.get(os.path.splitext(file)[1].lower(), "application/octet-stream"), body)

    @staticmethod
    def send(w, code, ctype, body):
        reason = {200: "OK", 404: "Not Found"}.get(code, "")
        w.write(("HTTP/1.1 %d %s\r\nContent-Type: %s\r\nContent-Length: %d\r\nCache-Control: no-cache\r\n"
                 "Connection: close\r\n\r\n" % (code, reason, ctype, len(body))).encode() + body)

    # ---- WebSocket framing (RFC 6455, no extensions) ----------------------------------------------------
    @staticmethod
    def ws_frame(op, payload=b""):
        n = len(payload)
        if n < 126:
            h = bytes([0x80 | op, n])
        elif n < 65536:
            h = bytes([0x80 | op, 126]) + struct.pack(">H", n)
        else:
            h = bytes([0x80 | op, 127]) + struct.pack(">Q", n)
        return h + payload

    @staticmethod
    async def ws_read(r):
        """One frame from the client: (opcode, payload). Fragmented messages are not expected from this app."""
        b0, b1 = await r.readexactly(2)
        n = b1 & 0x7F
        if n == 126:
            n = struct.unpack(">H", await r.readexactly(2))[0]
        elif n == 127:
            n = struct.unpack(">Q", await r.readexactly(8))[0]
        if n > 1 << 20:
            raise ConnectionError("frame too large")
        mask = await r.readexactly(4) if b1 & 0x80 else None
        data = await r.readexactly(n)
        if mask:
            data = bytes(c ^ mask[i & 3] for i, c in enumerate(data))
        return b0 & 0x0F, data

    async def ws(self, r, w, hdr):
        key = hdr.get("sec-websocket-key", "")
        accept = base64.b64encode(hashlib.sha1((key + WS_GUID).encode()).digest()).decode()
        w.write(("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                 "Sec-WebSocket-Accept: %s\r\n\r\n" % accept).encode())

        def text(s):
            w.write(self.ws_frame(1, s.encode()))

        if self.busy:
            text("error: bridge busy (another client is connected)")
            w.write(self.ws_frame(8, struct.pack(">H", 1008) + b"busy"))
            return
        self.busy = True
        fd = None
        connected = False
        ident = (0xC1, 0)
        loop = asyncio.get_running_loop()
        try:
            try:
                fd = open_serial(self.serial, self.baud)
            except OSError:
                await asyncio.sleep(1)  # the port can be busy for a moment after another program releases it
                try:
                    fd = open_serial(self.serial, self.baud)
                except OSError as e:
                    self.log("open failed %s" % e)
                    text("error: cannot open %s: %s" % (self.serial, e.strerror or e))
                    return
            self.log("client connected, %s open" % self.serial)

            def on_serial():  # one reader on the loop: chunks reach the client in the order they left the unit
                try:
                    data = os.read(fd, 1024)
                except (BlockingIOError, InterruptedError):
                    return
                except OSError as e:
                    self.log("serial read failed %s" % e)
                    loop.remove_reader(fd)
                    w.close()
                    return
                if data:
                    w.write(self.ws_frame(2, data))

            loop.add_reader(fd, on_serial)
            text("ready")
            pending = bytearray()
            while True:
                try:
                    op, data = await asyncio.wait_for(self.ws_read(r), CLIENT_SILENCE_S)
                except asyncio.TimeoutError:
                    self.log("client silent for %d s: dropping it" % CLIENT_SILENCE_S)
                    break
                if op == 8:
                    break
                if op == 9:
                    w.write(self.ws_frame(10, data))
                    continue
                if op != 2:
                    continue  # text ("ping") only counts as a sign of life
                pending += data
                while True:
                    s0 = pending.find(0xF0)
                    if s0 < 0:
                        pending.clear()
                        break
                    del pending[:s0]
                    if len(pending) < 13:
                        break
                    f = bytes(pending[:13])
                    del pending[:13]
                    why = check(f)
                    if why:
                        self.log("refused %s: %s" % (f.hex(" "), why))
                        text("refused: " + why)
                        continue
                    if f[3] == 0x00:
                        connected, ident = True, (f[1], f[2])
                    elif f[3] == 0x0F:
                        connected = False
                    await self.serial_write(fd, f)
                await w.drain()
        except (asyncio.IncompleteReadError, ConnectionError):
            pass
        except Exception as e:
            self.log("ws error %r" % e)
        finally:
            if fd is not None:
                try:
                    loop.remove_reader(fd)
                except Exception:
                    pass
                if connected:
                    try:
                        await self.serial_write(fd, bytes([0xF0, ident[0], ident[1], 0x0F, 0, 0, 0, 0, 0, 0, 0, 0, 0xF7]))
                        await asyncio.sleep(0.3)
                        self.log("client left while connected: sent disconnect")
                    except Exception as e:
                        self.log("exit disconnect failed %s" % e)
                try:
                    os.close(fd)
                except OSError:
                    pass
            self.busy = False
            self.log("client gone, %s closed" % self.serial)

    @staticmethod
    async def serial_write(fd, data: bytes):
        view = memoryview(data)
        while view:
            try:
                view = view[os.write(fd, view):]
            except (BlockingIOError, InterruptedError):
                await asyncio.sleep(0.005)


def main(a):
    root = a[0] if a else "dist"
    port = int(a[1]) if len(a) > 1 else 8240
    serial = a[2] if len(a) > 2 else "/dev/ttyUSB0"
    baud = int(a[3]) if len(a) > 3 else 9600
    host = a[4] if len(a) > 4 else "0.0.0.0"
    if baud not in BAUDS:
        sys.exit("unsupported baud %d" % baud)
    try:
        asyncio.run(Bridge(root, port, serial, baud, host).run())
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main(sys.argv[1:])
