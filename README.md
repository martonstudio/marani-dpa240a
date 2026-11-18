# Marani DPA240A control

Protocol and control app for the early-generation Marani / Seed Digital DPA240A speaker processor (panel "DPA240-A",
software V1.05, FTDI USB). Marani's published editors do not talk to this generation.

Link: 9600 8N1, 13-byte frames `f0 <model id> <dev> <cmd> <8 data bytes> f7`, model id `0xC1`. Never read memory at
0x2000 or above: the unit hangs. Amps off before testing writes.

| Topic | Owner |
| --- | --- |
| Command table, memory map, constraints | [PLAN](PLAN.md) |
| Next step | [NEXT](NEXT.md) |
| The app: what is built and what is left | [App plan](plans/APP_PLAN.md) |
| Control app (web, USB serial or bridge) | [app/](app) |
| Read the full state, change and restore each parameter type | [tools/dpa240a.py](tools/dpa240a.py) |
| Recorded exchanges behind each table row | [captures/](captures) |

## Vendor files
Referenced as `vendor/` and `Marani_dpa240/`, not redistributed.

| File | Source |
| --- | --- |
| `SetupDPA240A_v3.1.41.rar`, `SetupDPA240P_v1.5.5.rar`, `DPA240A_User_Manual.pdf`, `DPA480P_SerialProtocol.pdf` | marani-proaudio.com downloads |
| `SetupDPA480V2.5.rar`, `SetupDPA260MFRV231.rar`, `DPA2448QRT_V11.rar` | Wayback Machine, `marani-proaudio.com/public/` |
| `AN-DPA240-2448QRT1.pdf` | Marani application note |

Not affiliated with Marani.
