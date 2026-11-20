# APP PLAN — DPA240A control app

Lightweight control app, first on the Surface Pro over USB, later Android/iOS and other transports, later other units.
Protocol facts live in PLAN.md (command table, memory map, value scales). This file is the app contract.

## Requirements (user, 18 Nov)
- Friendly, professional graphical interface.
- Presets saved in the app, recalled, and pushed to the unit.
- Changes in the app are instant on the unit.
- Modular code: transport, device, presets and UI are swappable, so new units or similar hardware can be added later.
- Runs on the Surface now; easy to port to Android/iOS; USB now, other links later.

## Architecture: one web codebase (TypeScript + HTML/CSS), four layers with fixed interfaces

1. **Transport** (`src/transport/`): `open() / close() / write(bytes) / onData(cb)`.
   - `webserial.ts`: Web Serial API in Edge/Chrome (Surface now; 9600 8N1, DTR/RTS off). No server, no install.
   - `websocket.ts` (later): a small bridge on a Raspberry Pi Zero next to the unit, so phones and iPads reach it over Wi-Fi.
   - Native USB on Android (usb-serial-for-android inside a Capacitor shell) only if needed later. iOS has no USB serial: it goes through the Pi bridge.
2. **Protocol** (`src/protocol/`): frame codec for the Marani early dialect (`f0 <id> <dev> <cmd> D0..D7 f7`), request queue, one request in flight, echo matching, timeout and retry, connect on open and disconnect on close (also on page unload and errors).
3. **Device definition** (`src/devices/dpa240a.ts`, data, not code): channels (In A/B, Out 1-4), each parameter's command, data-byte layout, memory offset, raw<->display scale, range and which parameters are read-only. Built from PLAN.md's table. A second unit = a second definition file.
4. **Device model / store** (`src/model/`): reads the full state with 0x17 (0x0000-0x015F) on connect, holds it, applies edits by sending the one command and re-reading the affected bytes, and shows the read-back value. Slider drags are throttled (latest value wins, about 15 updates/s at 9600 baud).
5. **Presets** (`src/presets/`): app presets are JSON snapshots of the device model (name, unit type, values), stored in IndexedDB, with export/import as files. "Push to unit" sends every settable parameter (about 200 frames, roughly 8-10 s) with a progress bar and a full read-back diff at the end. Values the unit cannot take by command (EQ filter type, channel names, input select) are stored but marked "not pushed".
6. **UI** (`src/ui/`): components driven by the device definition, not hard-coded per unit:
   - channel strips (mute, source, gain, phase, delay);
   - an EQ graph (computed bell/HPF/LPF response, draggable band points, 7 output / 5 input bands);
   - crossover and limiter panels;
   - a routing selector;
   - a preset sidebar (save, recall, push, export).
   - Dark professional theme, large touch targets: the same layout works on a tablet.

## Packaging
- Surface: a static build (Vite) served from `localhost` (Web Serial needs a secure context; a tiny PowerShell static file server, or Edge "install as app" from a localhost page). A desktop shortcut starts it. No runtime installs on the Surface. Build on server or the Mac, copy over.
- Later: Capacitor shell for Android/iOS from the same build; the Pi serves the same build plus the WebSocket bridge.

## Safety rules carried into code
- The command whitelist lives in the protocol layer: only the verified commands (0x00, 0x0f, 0x01, 0x02, 0x03, 0x04, 0x05, 0x07, 0x08, 0x09, 0x17 with address < 0x2000). 0x28, 0x18, 0x10 and 0x24 are refused in code.
- Always disconnect on close, unload and error.

## State (18 Nov): milestones 1-5 built and verified on the unit
- Layers in `app/src/`: transport (webserial, websocket, sim), protocol (frame, guard, session), devices (types, dpa240a definition, logic), model (store with read-back and latest-wins), presets (snapshot, push with read-back diff, IndexedDB and file stores), ui. `app/cli/dpa.ts` drives the same layers from server: `tools/app.sh state|raw|fields|get|set|try|selftest|preset ...`.
- Surface: `dpa_bridge` task serves the build on http://localhost:8240 and a WebSocket to COM5 (`app/bridge/Bridge.cs`). Desktop shortcut "DPA Control" opens it as an Edge app window (USB via Web Serial, or Bridge). Deploy with `tools/deploy_app.sh`.
- Tests: `npm test` (unit, simulator), `npm run e2e:sim`, `npm run e2e:unit` (through the bridge tunnel; restores the unit), CLI `selftest` (all fields, all channels).
- Linux/macOS bridge: `app/bridge/bridge.py` (same protocol and frame checks as `Bridge.cs`, listens on the LAN), service file `tools/pi/dpa-bridge.service`, installer `tools/deploy_pi.sh`. Test: `python3 app/bridge/test_bridge.py` (simulated unit on a pseudo-terminal).
- Open items are in NEXT.md.

## Assumptions
- Web Serial in the Surface's Edge (157) opens COM5 (FT232R) at 9600 and talks to the unit: verified 18 Nov (state identical to the Python read; set/restore; disconnect on page close seen in a USB capture). The port chooser needs one click per Edge profile; after that `getPorts()` reconnects without it.
- Chrome on Android's Web Serial support for USB serial adapters is unchecked; check before choosing between Chrome-only and a Capacitor shell.
