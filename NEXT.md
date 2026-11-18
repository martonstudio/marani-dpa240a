# NEXT

The decoding run's finish line is met (command table in PLAN.md; `tools/dpa240a.py selftest` PASS on Out 1, 18 Nov). Remaining gaps before full control / a dashboard:

1. Value scales needing one panel check each (set a value, user reads the page, restore): gain byte -> dB (0x78 = current, likely 0 dB), delay units, limiter attack table (0x13 = 50 ms), PEQ Q byte -> BW (0x09 = BW 0.30), crossover slope codes, PEQ filter types (D3).
2. Inputs (chn 0/1): run `selftest` variants for gain, delay, PEQ on In A; test 0x0A compressor and 0x1A noise gate (document commands, inputs only), read where they land in memory.
3. Channel names, S/PDIF/analog input select, link: no command known; leave read-only from memory.
4. Level meters: no command known in the document; check whether any read returns live levels before planning a meter view.
5. Presets: 0x41 recall is in the document but untested (would replace live state; the preset name list is at 0x0180). 0x28 store stays forbidden unless the user lifts it.
6. Then the app/dashboard (not started; needs the user's go): serial over USB from a Mac or the Surface, using tools/dpa240a.py as the protocol layer.
