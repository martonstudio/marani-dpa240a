# NEXT

Map the early dialect's commands for the DPA240A (model id 0xC1), testing `vendor/DPA480P_SerialProtocol.pdf` directly (user-approved, amps off, settings stored in a preset, 18 Nov). Never send 0x28, 0x18, 0x10, 0x24 or anything not in that document. Always disconnect.

0. Waiting on the user: the unit stopped answering after a 0x17 read at 0x2000. User power-cycles it, then: `q.ps1` connect + disconnect to confirm it answers again.
1. Find the top of readable memory by stepping up from 0x1000 (e.g. 0x1400, 0x1800, 0x1c00, then finer), one read per session with disconnect, stop at the first silence (another power-cycle).
2. Dump 0x0000 up to that top with `tools/surface/dump.ps1` into `captures/mem_before.bin` as the state backup.
3. Mute then unmute one output with 0x09 (`f0 c1 00 09 <chn> 00 00 00 00 00 00 <0/1> f7`, chn 4 = Output1 per doc), confirm echoes, dump again and diff.
4. Then gain, delay, phase, crossover, EQ, limiter, routing one at a time: read current value from memory if located, change by a small step, confirm, change back. Fill the table in PLAN.md and commit per row.

Stop rule: a reply contradicting the document twice in a row means stop and report.
