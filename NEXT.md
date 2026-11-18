# NEXT

The decoding run's finish line is met (command table in PLAN.md; `tools/dpa240a.py selftest` PASS on Out 1, 18 Nov). Remaining gaps before full control / a dashboard:

1. Value scales still unread (rerun `scaleA_set.txt`, user types them, then `scaleA_restore.txt` and compare memory with captures/sb0.bin): limiter threshold for raw 0x64, HPF slope for code 3, LPF slope for code 7, PEQ-01 gain for 0x24, PEQ-02 type and gain for type 5 / 0x28. The camera cannot see the right edge of the display; ask the user to type these. Delay: derive the ms scale (switch Utility > System > Delay Units to ms, or compute from the metre readings).
2. Inputs (chn 0/1): run `selftest` variants for gain, delay, PEQ on In A; test 0x0A compressor and 0x1A noise gate (document commands, inputs only), read where they land in memory.
3. Channel names, S/PDIF/analog input select, link: no command known; leave read-only from memory.
4. Level meters: no command known in the document; check whether any read returns live levels before planning a meter view.
5. Presets: 0x41 recall is in the document but untested (would replace live state; the preset name list is at 0x0180). 0x28 store stays forbidden unless the user lifts it.
6. Then the app/dashboard (not started; needs the user's go). Preferred route (user, 18 Nov): Raspberry Pi Zero (user has one) on the unit's USB as a Wi-Fi bridge serving a web dashboard, reusing tools/dpa240a.py. A Bluetooth dongle on the unit cannot work (its USB port is device-side).
