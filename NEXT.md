# NEXT

## App (user asked for it on 18 Nov; this overrides CLAUDE.md's "do not start on any app")
Surface dashboard, zero install (Surface has PowerShell 5.1 + .NET 4, no Python/Node):
- `tools/app/server.ps1`: HttpListener on http://localhost:8240/, owns COM5 (connect on start, disconnect on exit and on any error, finally block), endpoints: GET /state (0x17 reads 0x0000-0x015F, decoded with the PLAN.md scales), POST /set {cmd, chn, values} restricted to the verified commands 0x01 0x02 0x03 0x04 0x05 0x07 0x08 0x09 (never 0x28 0x18 0x10 0x24, never 0x17 at 0x2000+), re-read the affected bytes after each set and return them.
- `tools/app/index.html`: one page, inputs A/B and outputs 1-4 as columns: mute, source, gain, delay, phase, limiter, HPF/LPF, 7 PEQ bands (5 on inputs) with real units from PLAN.md. Every control shows the value read back from the unit, not the value sent.
- Desktop shortcut `.bat` that starts the server (hidden) and opens Edge; closing the page or the server sends disconnect.
- Milestones: (1) server /state against the real unit, compare with `dpa240a.py state`; (2) /set for one parameter with read-back; (3) full page; (4) shortcut. Commit each.
- Known gaps the UI must show as read-only or absent: EQ filter type, names, input select, meters, presets.

## Protocol gaps (can run between app milestones)
0. EQ filter type: ask the user whether the panel's PEQ page offers a Type setting on this V1.05 firmware. If yes, try the type value in 0x05 D1/D2/D4 and diff the full 8 KB; if no, bell-only is a firmware fact.

The decoding run's finish line is met (command table in PLAN.md; `tools/dpa240a.py selftest` PASS on Out 1, 18 Nov). Remaining gaps before full control / a dashboard:

1. Remaining scales: delay in ms (have the user set Utility > System > Delay Units to ms for one reading, or derive from coarse/fine), gain range ends, attack table beyond indices 5 and 19, full BW table, source 3. Then fold all scales into tools/dpa240a.py `state` so it prints real units.
2. Inputs (chn 0/1): run `selftest` variants for gain, delay, PEQ on In A; test 0x0A compressor and 0x1A noise gate (document commands, inputs only), read where they land in memory.
3. Channel names, S/PDIF/analog input select, link: no command known; leave read-only from memory.
4. Level meters: no command known in the document; check whether any read returns live levels before planning a meter view.
5. Presets: 0x41 recall is in the document but untested (would replace live state; the preset name list is at 0x0180). 0x28 store stays forbidden unless the user lifts it.
6. Then the app/dashboard (not started; needs the user's go). Preferred route (user, 18 Nov): Raspberry Pi Zero (user has one) on the unit's USB as a Wi-Fi bridge serving a web dashboard, reusing tools/dpa240a.py. A Bluetooth dongle on the unit cannot work (its USB port is device-side).
