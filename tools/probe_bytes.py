#!/usr/bin/env python3
"""Stage 1 blind probe: send every single byte value at several serial settings, report any reply.
Single bytes cannot form a framed parameter-write in the known Marani formats."""
import os, termios, time, select, fcntl, struct
PORT="/dev/cu.usbserial-XXXXXXXX"
fd = os.open(PORT, os.O_RDWR | os.O_NOCTTY | os.O_NONBLOCK)
fcntl.ioctl(fd, termios.TIOCMBIC, struct.pack('I', termios.TIOCM_DTR | termios.TIOCM_RTS))
def setup(baud, parity):
    a = termios.tcgetattr(fd); a[0]=0; a[1]=0; a[3]=0
    c = termios.CS8 | termios.CREAD | termios.CLOCAL
    if parity=='E': c |= termios.PARENB
    if parity=='O': c |= termios.PARENB | termios.PARODD
    a[2]=c; a[4]=a[5]=getattr(termios,f"B{baud}"); a[6][termios.VMIN]=0; a[6][termios.VTIME]=0
    termios.tcsetattr(fd, termios.TCSANOW, a); termios.tcflush(fd, termios.TCIOFLUSH)
def rx(w):
    buf=b""; end=time.time()+w
    while time.time()<end:
        r,_,_=select.select([fd],[],[],0.01)
        if r: buf+=os.read(fd,256)
    return buf
hits=0
for baud in (1200,2400,4800,9600,19200,38400,57600,115200,230400):
    for par in ('N','E','O'):
        if par!='N' and baud not in (9600,19200,38400,115200): continue
        setup(baud,par); time.sleep(0.05)
        for b in range(256):
            os.write(fd, bytes([b])); r=rx(0.03)
            if r: hits+=1; print(f"HIT {baud} 8{par}1 byte {b:02x} -> {r.hex(' ')}", flush=True)
        r=rx(0.3)
        if r: hits+=1; print(f"HIT {baud} 8{par}1 trailing -> {r.hex(' ')}", flush=True)
        print(f"{baud} 8{par}1 done", flush=True)
print("stage1 done hits=",hits)
os.close(fd)
