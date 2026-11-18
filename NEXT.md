# NEXT

Map the early dialect's commands for the DPA240A (model id 0xC1).

1. Try the DPA260MFR V2.3 (model id 0x12) and DPA480 V2.5 editors through `tools/surface/relay.ps1` in their network modes, the same way as the DPA2448QRT one: patch a copy of the exe so its IP list prefix points at 127.x (search the exe for UTF-16 "192.168.0."), set `-FromId` to the editor's model id, and start the relay with a dedicated .bat (schtasks /tr cannot carry quoted arguments here). Check whether their device search uses a command this unit answers; 0x1a does not get answered.
2. If no editor gets past the search in network mode, the remaining user-level route for USB mode is a userland COM emulation that needs no driver; if none exists, ask the user about a virtual COM pair driver (com0com).
3. Once an editor reaches its parameter screens: record connect, the full state read, then (after the amps gate in CLAUDE.md) one change per parameter type.

Done = a table in PLAN.md of command number -> meaning for read-state, gain, mute, delay, phase, crossover, EQ, limiter and routing, each backed by a recorded exchange with the unit.
