#!/usr/bin/env python3
"""DPA240A control through the Surface (COM5), using the verified command table in PLAN.md.

  python3 tools/dpa240a.py state            read live memory 0x0000-0x015F and print every channel's parameters
  python3 tools/dpa240a.py selftest [chn]   on one output (default 2 = Out 1): change gain, delay, phase, HPF, LPF,
                                            PEQ band 1, limiter, routing and mute, confirm each in live memory, restore each,
                                            and check that the live state ends identical to the start.

All exchanges go through tools/surface/vtest.ps1 / dump.ps1 on the Surface (one connect session each, always disconnected).
"""
import subprocess, sys, re

HOST = "user@192.168.1.66"
PS = "powershell -NoProfile -ExecutionPolicy Bypass -File C:\\Users\\User\\dpa\\"
TOP = 0x160

def ssh(cmd, timeout=600):
    return subprocess.run(["ssh", "-o", "BatchMode=yes", HOST, cmd + " < NUL"], capture_output=True, text=True, timeout=timeout).stdout

def frame(cmd, d):
    return " ".join(f"{b:02x}" for b in [0xF0, 0xC1, 0, cmd] + list(d) + [0xF7])

def read_state():
    out = ssh(PS + f"dump.ps1 -from 0 -to {TOP} -out C:\\Users\\User\\dpa\\state.bin")
    if "missing 0" not in out or "disconnect f0 c1 00 0f" not in out:
        raise SystemExit("state read failed: " + out)
    subprocess.run(["scp", "-q", HOST + ":dpa/state.bin", "/tmp/dpa_state.bin"], check=True)
    return open("/tmp/dpa_state.bin", "rb").read()

def freq(idx):
    return 20 * 2 ** (idx / 24)

def out_base(chn):
    return 0x66 + 0x28 * (chn - 2)

def describe(m):
    lines = [f"preset name: {m[0:16].decode('ascii', 'replace').strip()}", f"mute mask 0x0158: {m[0x158]:08b} (bit n = chn n)"]
    for chn, nm in ((0, "In A"), (1, "In B")):
        o = 0x40 + 0x13 * chn
        bands = [f"{freq(m[o+4+3*i]):.0f}Hz/q{m[o+5+3*i]}/{(m[o+6+3*i]-30)/2:+.1f}dB" for i in range(5)]
        lines.append(f"{nm}: gain byte {m[o]} delay {m[o+1:o+4].hex(' ')} PEQ {' '.join(bands)}")
    for chn in range(2, 6):
        o = out_base(chn); b = m[o:o + 0x28]
        bands = [f"{freq(b[13+3*i]):.0f}Hz/q{b[14+3*i]}/{(b[15+3*i]-30)/2:+.1f}dB" for i in range(7)]
        lines.append(f"Out {chn-1} '{b[34:40].decode('ascii','replace')}' (chn {chn}): source {b[0]} gain {b[1]} "
                     f"lim atk {b[2]} rel {b[3]} thr {b[4]} delay {b[5]:02x}{b[6]:02x}+{b[7]} phase {b[8]} "
                     f"HPF {freq(b[9]):.0f}Hz s{b[10]} LPF {freq(b[11]):.0f}Hz s{b[12]}\n    PEQ {' '.join(bands)}")
    return "\n".join(lines)

def selftest(chn=2):
    m = read_state(); o = out_base(chn); b = m[o:o + 0x28]
    g, ph = b[1], b[8]
    tests = [  # name, set frame, restore frame, memory offset expected to change, expected value
        ("gain", frame(0x01, [chn, 0, 0, 0, 0, 0, 0, g - 10]), frame(0x01, [chn, 0, 0, 0, 0, 0, 0, g]), o + 1, g - 10),
        ("delay", frame(0x02, [chn, 0, 0, 0, 0, b[5], b[6], b[7] + 1]), frame(0x02, [chn, 0, 0, 0, 0, b[5], b[6], b[7]]), o + 7, b[7] + 1),
        ("phase", frame(0x03, [chn, 0, 0, 0, 0, 0, 1 - ph, g]), frame(0x03, [chn, 0, 0, 0, 0, 0, ph, g]), o + 8, 1 - ph),
        ("hpf", frame(0x04, [chn, 0, 0, 0, 0, 0, b[9] + 24, b[10]]), frame(0x04, [chn, 0, 0, 0, 0, 0, b[9], b[10]]), o + 9, b[9] + 24),
        ("lpf", frame(0x04, [chn, 1, 0, 0, 0, 0, b[11] - 24, b[12]]), frame(0x04, [chn, 1, 0, 0, 0, 0, b[11], b[12]]), o + 11, b[11] - 24),
        ("peq1", frame(0x05, [chn, 0, 0, 0, 0, b[13], b[14], b[15] + 6]), frame(0x05, [chn, 0, 0, 0, 0, b[13], b[14], b[15]]), o + 15, b[15] + 6),
        ("limiter", frame(0x07, [chn, 0, 0, 0, 0, b[2], b[3], b[4] - 10]), frame(0x07, [chn, 0, 0, 0, 0, b[2], b[3], b[4]]), o + 4, b[4] - 10),
        ("routing", frame(0x08, [chn, 0, 0, 0, 0, 0, 0, b[0] ^ 1]), frame(0x08, [chn, 0, 0, 0, 0, 0, 0, b[0]]), o, b[0] ^ 1),
        ("mute", frame(0x09, [chn, 0, 0, 0, 0, 0, 0, 0 if m[0x158] >> chn & 1 else 1]), frame(0x09, [chn, 0, 0, 0, 0, 0, 0, m[0x158] >> chn & 1]), 0x158, m[0x158] ^ (1 << chn)),
    ]
    spec = ";".join(f"{n}|{s}|{r}" for n, s, r, _, _ in tests)
    out = ssh(PS + f'vtest.ps1 -tests "{spec}"', timeout=900)
    print(out)
    ok = True
    for n, s, r, addr, val in tests:
        blk = out.split(f"== {n}\n")[1].split("==")[0]
        want = f"{addr:04x}:{m[addr]:02x}->{val:02x}"
        diff = re.search(r"diff\s+(.*)", blk).group(1); res = re.search(r"residue\s+(.*)", blk).group(1)
        echo = f"RX {s}" in blk
        good = echo and want in diff and res == "none"
        ok &= good
        print(f"{n:8} echo {'ok' if echo else 'NO'}  change {want} {'seen' if want in diff else 'NOT SEEN'}  restored {'yes' if res == 'none' else res}  -> {'PASS' if good else 'FAIL'}")
    end = read_state()
    same = end == m
    print("final state identical to start:", same, "" if same else [hex(i) for i in range(TOP) if end[i] != m[i]])
    print("SELFTEST", "PASS" if ok and same else "FAIL")
    return ok and same

if __name__ == "__main__":
    if len(sys.argv) < 2 or sys.argv[1] not in ("state", "selftest"):
        raise SystemExit(__doc__)
    if sys.argv[1] == "state":
        print(describe(read_state()))
    else:
        sys.exit(0 if selftest(int(sys.argv[2]) if len(sys.argv) > 2 else 2) else 1)
