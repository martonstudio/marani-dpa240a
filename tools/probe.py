#!/usr/bin/env python3
"""Read-only probe: CMD_VERIFY (50H) and CMD_READ_VERSION (22H), DPA480P frame format."""
import os, sys, termios, time, select
PORT = sys.argv[1] if len(sys.argv) > 1 else "/dev/cu.usbserial-XXXXXXXX"
fd = os.open(PORT, os.O_RDWR | os.O_NOCTTY | os.O_NONBLOCK)
a = termios.tcgetattr(fd)
a[0] = 0; a[1] = 0; a[3] = 0
a[2] = termios.CS8 | termios.CREAD | termios.CLOCAL
a[4] = a[5] = termios.B115200
a[6][termios.VMIN] = 0; a[6][termios.VTIME] = 0
termios.tcsetattr(fd, termios.TCSANOW, a)
termios.tcflush(fd, termios.TCIOFLUSH)
def xfer(cmd, idm=0x21, idn=0, data=bytes(8), wait=1.0):
    f = bytes([0x80 + 13, idm, idn, cmd]) + data + bytes([0xF7])
    os.write(fd, f)
    buf = b""; end = time.time() + wait
    while time.time() < end:
        r, _, _ = select.select([fd], [], [], 0.05)
        if r:
            buf += os.read(fd, 256)
    print(f"TX {f.hex(' ')}\nRX {buf.hex(' ') or '(nothing)'}")
    return buf
# listen first: does the unit send anything unprompted?
time.sleep(0.5); r,_,_ = select.select([fd],[],[],0.5)
print("idle:", os.read(fd,256).hex(' ') if r else "(silent)")
xfer(0x50)
xfer(0x22)
os.close(fd)
