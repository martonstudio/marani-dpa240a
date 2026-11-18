# Marani DPA240A control

Protocol notes and control software for an early-generation Marani / Seed Digital
DPA240A speaker processor (front panel "DPA240-A", software version V1.05, FTDI USB
chip). Marani's current editors do not talk to this generation, and its own editor
(`SetupDPA240AV33.rar`) is no longer available anywhere we could find.

- `PLAN.md`: the decoded protocol. Serial settings, frame format, the command table
  and the memory map, each backed by a recording in `captures/`.
- `tools/`: scripts used to decode and test (`dpa240a.py` reads the full state and
  changes each parameter type).
- `app/`: the control app (web, talks to the unit over USB serial or a small bridge).
- `captures/`: recorded exchanges with the unit.

Serial link in short: 9600 baud, 8N1, 13-byte frames `f0 <model id> <dev> <cmd> <8 data bytes> f7`,
model id `0xC1`. See `PLAN.md` before sending anything to a unit; one read command
hangs the unit above its memory range.

## Vendor files not included

Marani's installers and documents are referenced in the notes under `vendor/` and
`Marani_dpa240/` but are not redistributed here. Sources:

| File | Source |
|---|---|
| `SetupDPA240A_v3.1.41.rar`, `SetupDPA240P_v1.5.5.rar`, `DPA240A_User_Manual.pdf` | marani-proaudio.com downloads |
| `DPA480P_SerialProtocol.pdf` (the closest published protocol) | marani-proaudio.com downloads |
| `SetupDPA480V2.5.rar`, `SetupDPA260MFRV231.rar`, `DPA2448QRT_V11.rar` | Wayback Machine copies of `marani-proaudio.com/public/` |
| `AN-DPA240-2448QRT1.pdf` | Marani application note |

Not affiliated with Marani. Use at your own risk: amplifiers off while testing writes.
