# NEXT

The decoding run's finish line is met (command table in PLAN.md; `tools/dpa240a.py selftest` PASS on Out 1, 18 Nov). Remaining gaps before full control / a dashboard:

1. Value scales: one panel run is prepared. Send `tools/surface/scaleA_set.txt` (wrapped in connect/disconnect via seq.ps1; raw values: gain 0x6e, delay 00 01 +5, phase 1, limiter atk 05 rel 09 thr 0x64, HPF idx 0x30 slope 3, LPF idx 0xC0 slope 7, PEQ1 Q 0x14 gain 0x24, PEQ2 type 5 idx 0x60 gain 0x28, source 2), have the user read Out 1's pages (Source, Gain, Delay, Phase, Limiter, HPF, LPF, PEQ-01, PEQ-02), then send `scaleA_restore.txt` and confirm memory 0x0000-0x03FF equals captures/sa0.bin. PEQ type (0x05 D3) leaves no trace in memory, so only the panel shows it.
2. Inputs (chn 0/1): run `selftest` variants for gain, delay, PEQ on In A; test 0x0A compressor and 0x1A noise gate (document commands, inputs only), read where they land in memory.
3. Channel names, S/PDIF/analog input select, link: no command known; leave read-only from memory.
4. Level meters: no command known in the document; check whether any read returns live levels before planning a meter view.
5. Presets: 0x41 recall is in the document but untested (would replace live state; the preset name list is at 0x0180). 0x28 store stays forbidden unless the user lifts it.
6. Then the app/dashboard (not started; needs the user's go). Preferred route (user, 18 Nov): Raspberry Pi Zero (user has one) on the unit's USB as a Wi-Fi bridge serving a web dashboard, reusing tools/dpa240a.py. A Bluetooth dongle on the unit cannot work (its USB port is device-side).
