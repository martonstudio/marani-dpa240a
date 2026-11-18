# NEXT

Map the DPA240A (id 0xC1) by testing `vendor/DPA480P_SerialProtocol.pdf` directly (user-approved 18 Nov; amps off, settings stored in a preset). Never send 0x28, 0x18, 0x10, 0x24 or anything not in that document. Never read 0x17 at 0x2000 or above (hangs the unit). Always disconnect. The user confirms effects by watching the front panel: agree a timed script with them first, start on their "go" (pattern: `tools/surface/vis.ps1`).

1. Channel map for mute 0x09: mute chn 0..11 one at a time, 5 s apart, each unmuted before the next; the user notes which panel channel lights at each step (count from the "system lock" message). Ask beforehand whether any channel was muted before 18 Nov 13:10 (the last run left all 12 unmuted).
2. Then, one per visual run, with the user watching: gain (0x45 relative +/-, then 0x01 if the panel shows a level), phase 0x03, delay 0x02, crossover 0x04, EQ 0x05/0x06, limiter 0x07, routing 0x08. Ask the user what the panel can show for each before choosing the test. Undo each change in the same run; absolute-value commands only after the current value is known from the panel.
3. Fill PLAN.md's command table per verified row; commit per row.
4. Then the finish-line script in `tools/` (CLAUDE.md).
