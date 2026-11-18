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

## Milestones (one commit each, each verified on the real unit)
1. Skeleton and layers with interfaces. Web Serial transport and protocol: connect, read full state, disconnect, shown as a raw table in the browser on the Surface. Compare with `tools/dpa240a.py state`.
2. Device definition and model: decoded values in real units. One live control (Out 1 gain) with read-back; restore afterwards.
3. Full UI for all verified parameters, channel strips and EQ graph.
4. Presets: save, recall, export/import, push with progress and read-back diff.
5. Packaging: localhost server, desktop shortcut, install-as-app.
Later: Pi WebSocket bridge, Capacitor builds, second device definition.

## Unverified assumptions to check first in milestone 1
- Web Serial in the Surface's Edge opens the FTDI COM5 at 9600 with DTR/RTS off (known to work in Chromium on Windows; not yet tried here).
- Chrome on Android's Web Serial support for USB serial adapters (it would remove the need for a native shell on Android). Check current support before relying on it.
