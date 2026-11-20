#!/usr/bin/env python3
"""Tests bridge.py against a simulated unit on a pseudo-terminal. No hardware needed.

Run: python3 app/bridge/test_bridge.py     (needs the `websockets` package for the client side only)
"""
import asyncio
import json
import os
import pty
import sys
import tempfile
import threading
import tty
import urllib.request

import websockets

HERE = os.path.dirname(os.path.abspath(__file__))
PORT = 18240
URL = "ws://127.0.0.1:%d/ws" % PORT


def frame(cmd, *data):
    d = list(data) + [0] * (8 - len(data))
    return bytes([0xF0, 0xC1, 0x00, cmd] + d + [0xF7])


class FakeUnit(threading.Thread):
    """Answers like the DPA240A: connect, disconnect, 0x17 reads, echo for parameter commands."""

    def __init__(self, master):
        super().__init__(daemon=True)
        self.master = master
        self.seen = []
        self.mem = bytes(range(256)) * 32  # 8 KB of recognisable data

    def run(self):
        buf = bytearray()
        while True:
            try:
                chunk = os.read(self.master, 256)
            except OSError:
                return
            if not chunk:
                return
            buf += chunk
            while len(buf) >= 13:
                f = bytes(buf[:13])
                del buf[:13]
                self.seen.append(f)
                c = f[3]
                if c == 0x00:
                    reply = bytes([0xF0, 0xC1, 0, 0, 0xC1, 0, 0, 0, 0, 0, 0, 0, 0xF7])
                elif c == 0x17:
                    a = (f[4] << 8) | f[5]
                    reply = bytes([0xF0, 0xC1, 0, 0x17, f[4], f[5]]) + self.mem[a:a + 4] + bytes([0, 0, 0xF7])
                else:
                    reply = f
                os.write(self.master, reply)


async def recv_bin(ws, n=13, timeout=3):
    out = b""
    while len(out) < n:
        m = await asyncio.wait_for(ws.recv(), timeout)
        if isinstance(m, bytes):
            out += m
    return out


async def main():
    master, slave = pty.openpty()
    tty.setraw(master)
    unit = FakeUnit(master)
    unit.start()
    root = tempfile.mkdtemp()
    dist = os.path.join(root, "dist")
    os.mkdir(dist)
    with open(os.path.join(dist, "index.html"), "w") as f:
        f.write("<p>dpa</p>")
    with open(os.path.join(root, "secret.txt"), "w") as f:
        f.write("outside the web root")
    proc = await asyncio.create_subprocess_exec(
        sys.executable, os.path.join(HERE, "bridge.py"), dist, str(PORT), os.ttyname(slave), "9600", "127.0.0.1",
        stdout=asyncio.subprocess.DEVNULL)
    ok = True

    def check(name, cond, detail=""):
        nonlocal ok
        ok = ok and bool(cond)
        print(("PASS " if cond else "FAIL ") + name + (" " + str(detail) if detail and not cond else ""))

    try:
        for _ in range(50):  # wait for the listener
            try:
                urllib.request.urlopen("http://127.0.0.1:%d/api/status" % PORT, timeout=1).read()
                break
            except OSError:
                await asyncio.sleep(0.1)

        get = lambda p: urllib.request.urlopen("http://127.0.0.1:%d%s" % (PORT, p), timeout=2)
        check("serves index.html at /", get("/").read() == b"<p>dpa</p>")
        st = json.loads(get("/api/status").read())
        check("status: idle before a client", st["busy"] is False, st)
        try:
            get("/../secret.txt")
            check("refuses paths outside the web root", False)
        except urllib.error.HTTPError as e:
            check("refuses paths outside the web root", e.code == 404, e.code)

        async with websockets.connect(URL) as ws:
            check("sends ready once the port is open", await asyncio.wait_for(ws.recv(), 3) == "ready")
            check("status: busy with a client", json.loads(get("/api/status").read())["busy"] is True)

            await ws.send(frame(0x00))
            r = await recv_bin(ws)
            check("connect reaches the unit and its reply comes back", r == bytes.fromhex("f0c10000c100000000000000f7"), r.hex())

            await ws.send(frame(0x17, 0x00, 0x10))
            r = await recv_bin(ws)
            check("memory read returns the unit's bytes", r[4:10] == bytes([0x00, 0x10, 0x10, 0x11, 0x12, 0x13]), r.hex())

            a, b = frame(0x01, 2, 0, 0, 0, 0, 0, 0, 0x78), frame(0x09, 3, 0, 0, 0, 0, 0, 0, 1)
            await ws.send(a[:5])  # frames split and joined across messages
            await ws.send(a[5:] + b)
            r = await recv_bin(ws, 26)
            check("frames split across messages are reassembled in order", r == a + b, r.hex())

            before = len(unit.seen)
            for name, bad in [("forbidden command 0x28", frame(0x28)), ("forbidden command 0x18", frame(0x18)),
                              ("unknown command 0x50", frame(0x50)), ("read at 0x2000", frame(0x17, 0x20, 0x00)),
                              ("wrong model id", bytes([0xF0, 0x02]) + frame(0x00)[2:]),
                              ("channel 6", frame(0x01, 6))]:
                await ws.send(bad)
                m = await asyncio.wait_for(ws.recv(), 3)
                check("refuses " + name, isinstance(m, str) and m.startswith("refused:"), m)
            await asyncio.sleep(0.2)
            check("refused frames never reach the unit", len(unit.seen) == before, unit.seen[before:])

            async with websockets.connect(URL) as ws2:
                m = await asyncio.wait_for(ws2.recv(), 3)
                check("second client is told the bridge is busy", m.startswith("error: bridge busy"), m)

            await ws.send("ping")
            await ws.send(frame(0x17, 0x1F, 0xFC))
            r = await recv_bin(ws)
            check("highest allowed read (0x1FFC) passes", r[3] == 0x17 and r[4:6] == bytes([0x1F, 0xFC]), r.hex())
            # leave without a disconnect: the bridge must send it
        await asyncio.sleep(1.0)
        check("bridge sends disconnect when a connected client leaves", unit.seen[-1] == frame(0x0F), unit.seen[-1].hex())
        check("status: idle again after the client left", json.loads(get("/api/status").read())["busy"] is False)

        async with websockets.connect(URL) as ws:
            check("a new client can connect afterwards", await asyncio.wait_for(ws.recv(), 3) == "ready")
            await ws.send(frame(0x00))
            await recv_bin(ws)
            await ws.send(frame(0x0F))
            await recv_bin(ws)
        await asyncio.sleep(0.6)
        check("no extra disconnect after a clean disconnect", unit.seen[-2:] == [frame(0x00), frame(0x0F)],
              [f.hex() for f in unit.seen[-3:]])
    finally:
        proc.terminate()
        await proc.wait()
    print("ALL PASS" if ok else "FAILED")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
