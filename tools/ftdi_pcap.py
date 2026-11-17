#!/usr/bin/env python3
"""Decode a USBPcap capture of an FTDI serial device: baud/line settings + bytes each way."""
import struct, sys
d = open(sys.argv[1], 'rb').read()
assert struct.unpack('<I', d[:4])[0] == 0xa1b2c3d4
off = 24; t0 = None
FR = [0, .5, .25, .125, .375, .625, .75, .875]
REQ = {0:'RESET',1:'MODEM_CTRL',2:'FLOW_CTRL',3:'SET_BAUD',4:'SET_DATA',5:'GET_STATUS',9:'LATENCY'}
last = None
while off + 16 <= len(d):
    ts, tu, il, ol = struct.unpack('<IIII', d[off:off+16]); off += 16
    p = d[off:off+il]; off += il
    hl, irp, st, fn, info, bus, dev, ep, tr, dl = struct.unpack('<HQIHBHHBBI', p[:27])
    data = p[hl:]
    t = ts + tu/1e6; t0 = t0 or t
    if tr == 2:  # control
        stage = p[27]
        if stage == 0 and len(data) >= 8:
            bm, br, wv, wi, wl = struct.unpack('<BBHHH', data[:8])
            if bm == 0x40:
                extra = ''
                if br == 3:
                    div = wv & 0x3fff; fr = FR[((wv >> 14) & 3) | ((wi & 1) << 2)]
                    baud = 3000000 if div == 0 else 2000000 if div == 1 else 3000000/(div+fr)
                    extra = f' -> {baud:.0f} baud'
                if br == 4:
                    extra = f' -> {wv & 0xff} data bits, parity {(wv>>8)&7}, stop {(wv>>11)&3}'
                print(f'{t-t0:8.3f} dev{dev} CTRL {REQ.get(br,br)} wValue={wv:04x} wIndex={wi:04x}{extra}')
    elif tr == 3 and data:  # bulk
        if ep & 0x80:
            pay = b''.join(data[i+2:i+64] for i in range(0, len(data), 64))
            if not pay: continue
            print(f'{t-t0:8.3f} dev{dev} RX  {pay.hex(" ")}')
        else:
            print(f'{t-t0:8.3f} dev{dev} TX  {data.hex(" ")}')
