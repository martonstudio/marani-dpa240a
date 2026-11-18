# NEXT

Map the early dialect's commands for the DPA240A (model id 0xC1).

Waiting on the user. Both network-mode routes stopped short of the parameter screens (see PLAN.md Constraints: 2448QRT faked search, DPA480 scan):
- 2448QRT: past the search with a faked 0x1a echo, but loading the device needs real 0x1a memory data, which the unit does not answer, and then sends 0x10/0x24, which are unclassified. Forwarding 0x10/0x24 to the unit needs the user's decision (they may be writes).
- DPA480: its TCP scan rejects every address tried.

1. User decision: forward 0x10 and 0x24 from the 2448QRT editor to the unit (after the amps gate), or move to the virtual COM pair driver (com0com), which the user does attended.
2. Once an editor reaches its parameter screens: record connect, the full state read, then (after the amps gate) one change per parameter type.

Done = a table in PLAN.md of command number -> meaning for read-state, gain, mute, delay, phase, crossover, EQ, limiter and routing, each backed by a recorded exchange with the unit.
