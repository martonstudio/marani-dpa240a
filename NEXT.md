# NEXT

Map the early dialect's commands for the DPA240A (model id 0xC1).

Download and install the DPA2448QRT V11 editor from the Wayback Machine first (same hardware as this unit; the archive rate-limits, so one request at a time). Make an early-generation editor talk to this unit so its traffic can be recorded: put a small relay between the editor and COM5 that rewrites the editor's model id (0x12 for DPA260MFR V2.3, or whatever DPA480 V2.5 uses) to 0xC1 and back, then record connect, the full state read, and one change per parameter type. Amps off before any parameter is changed. Compare what is seen against the DPA480P document's command numbers.

Done = a table in PLAN.md of command number -> meaning for read-state, gain, mute, delay, phase, crossover, EQ and limiter, each backed by a recorded exchange with the unit.
