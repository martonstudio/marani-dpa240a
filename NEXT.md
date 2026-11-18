# NEXT

## App
Milestones 1-5 of `plans/APP_PLAN.md` are built and verified on the unit (see the plan's "State" section). Open items:
1. Panel check, batched in one timed run with the user: Utility > System > Delay Units = ms, set Out 1 delay to coarse 10 + fine 24 from the app; panel should show 10.5 ms if the derived scale (1 ms + 1/48 ms) is right. Same run: name of crossover slope 8 (set Out 1 HPF slope 8, read the panel), attack index 0 and 29, BW index 0 and 63.
2. Recall takes ~20 s because push reads the full state twice before and after (verified reads); if that is too slow, read once before and verify only after.
3. Later: Pi WebSocket bridge (same bridge protocol: "ready" text, binary frames), Capacitor Android build, second device definition.

## iPhone/iPad remote + measurement (user idea, 18 Nov; not started, own session)
Goal: an iOS app that remote-controls the app connected to the unit, plays test signals and measures with the microphone.
Plan to evaluate first (one planning session, Opus, plan mode):
1. Remote control: reuse the web app as an installable PWA on iOS, talking to the bridge's WebSocket over the LAN. Blockers: the Surface bridge listens on localhost only (LAN binding needs an http.sys URL reservation and a firewall rule = admin/registry change, user gate) and iOS needs HTTPS for microphone access; Tailscale HTTPS certificates (`tailscale cert`) or the Pi bridge are the candidate routes. Two clients at once (Surface page + phone) also needs the bridge to share one serial session instead of refusing the second client.
2. Test tones: Web Audio on iOS (pink noise, sine, log sweep), started from a tap.
3. Measurement: log-sweep transfer function (no clock sync needed) and an RTA. Check how far Safari lets getUserMedia turn off echo cancellation / noise suppression / auto gain; the built-in mic is uncalibrated, so plan for a calibration file or an external measurement mic. If Safari cannot give a clean signal, that is the reason to go native (AVAudioSession .measurement mode), which needs a Mac, Xcode and an Apple developer account (A$149/yr for normal installs).
Verification: phone changes Out 1 gain through the bridge with read-back; a sweep measured through the system shows the PEQ change that was made.

## Protocol gaps (can run between app milestones)
0. EQ filter type: ask the user whether the panel's PEQ page offers a Type setting on this V1.05 firmware. If yes, try the type value in 0x05 D1/D2/D4 and diff the full 8 KB; if no, bell-only is a firmware fact.

The decoding run's finish line is met (command table in PLAN.md; `tools/dpa240a.py selftest` PASS on Out 1, 18 Nov). Remaining gaps before full control / a dashboard:

1. Remaining scales: delay in ms (have the user set Utility > System > Delay Units to ms for one reading, or derive from coarse/fine), gain range ends, attack table beyond indices 5 and 19, full BW table, source 3. Then fold all scales into tools/dpa240a.py `state` so it prints real units.
2. Inputs (chn 0/1): run `selftest` variants for gain, delay, PEQ on In A; test 0x0A compressor and 0x1A noise gate (document commands, inputs only), read where they land in memory.
3. Channel names, S/PDIF/analog input select, link: no command known; leave read-only from memory.
4. Level meters: no command known in the document; check whether any read returns live levels before planning a meter view.
5. Presets: 0x41 recall is in the document but untested (would replace live state; the preset name list is at 0x0180). 0x28 store stays forbidden unless the user lifts it.
6. Then the app/dashboard (not started; needs the user's go). Preferred route (user, 18 Nov): Raspberry Pi Zero (user has one) on the unit's USB as a Wi-Fi bridge serving a web dashboard, reusing tools/dpa240a.py. A Bluetooth dongle on the unit cannot work (its USB port is device-side).
