# PLAN — Marani DPA240A controller

## Finish line
An Android app that, plugged into the DPA240A with an OTG cable, reads and sets every parameter the Windows editor can. A Mac app comes first and shares the protocol layer.

## Steps
1. Get any reply from the unit over `/dev/cu.usbserial-XXXXXXXX` (read-only query).
2. Decode the full protocol: every parameter, read and write, plus level meters.
3. Mac command-line tool that proves each command against the real unit.
4. Mac app with full control.
5. Port to Android (`usb-serial-for-android`, OTG).

## Constraints
- THE UNIT ANSWERS. Settings: 9600 baud, 8N1, DTR/RTS off, 13-byte frames `f0 <id> <dev> <cmd> <8 data bytes> f7`, model id **0xC1**, dev 0 for USB. Verified exchanges (sent from the Surface, COM5):
  - connect: TX `f0 c1 00 00 00 00 00 00 00 00 00 00 f7` -> RX `f0 c1 00 00 c1 00 00 00 00 00 00 00 f7`
  - disconnect: TX `f0 c1 00 0f 00*8 f7` -> RX identical echo
  - cmd 0x22: echoed once, shortly after a connect/disconnect pair, and not answered on two later tries without one. Whether the unit only answers some commands while connected is an open question to settle first.
  - cmd 0x50 and 0x7d (the later editors' presence queries): no reply. Unknown commands are ignored silently.
- This is the early-generation dialect. Its only sample so far is the DPA260MFR V2.3 editor (model id 0x12), recorded in `captures/cap4_260MFR_V23.pcap`; installers from the Wayback Machine are in `vendor/wayback/`. The DPA480 V2.5 editor is also installed on the Surface and not yet recorded. `SetupDPA240AV33.rar` (the unit's own editor) is not archived anywhere reachable.
- `Marani_dpa240/AN-DPA240-2448QRT1.pdf` (application note, no protocol) states the DPA240A shares its hardware with the DPA2448QRT and lists the unit's features: per input 5-band parametric EQ, gain, delay; per output 7-band parametric EQ, crossover up to 24 dB/oct, RMS limiter, delay; full input-to-output matrix; S/PDIF input. The DPA2448QRT editor (`SetupDPA2448QRTV11.rar`) is the closest relative of the missing V33 editor and is downloaded to `vendor/wayback/DPA2448QRT_V11.rar` (not yet unpacked, inspected or installed): use it first. The other three PDFs in that folder are compliance certificates.
- Opening COM5 can fail ("The port is closed") for a moment after another program releases it: wait a second and retry once before treating it as an error.
- The DPA2448QRT V1.1 editor is installed on the Surface at `C:\Program Files (x86)\DPA2448QRT V1.1\DPA2448QRT_V1.1.exe` (not yet launched). server has no `innoextract` or `pdftotext`; unpack installers on the Mac if more are needed.
- DPA2448QRT V1.1 editor port choice: its COM drop-down only lists COM 7 and up and a click on its scroll bar dismisses the list, so the port is set through `init.cfg` in its program folder (10 bytes, byte 0 = COM number; `05 00 00 00 00 00 00 00 00 00` makes it show COM 5, observed). Close the editor before editing; the editor rewrites the file on exit. Do not renumber the Surface's COM port (denied by the permission check).
- DPA2448QRT V1.1 editor connect, recorded in `captures/cap6_2448QRT_connect.pcap` (editor on COM5, unit silent): same frame format, model id **0x09**, sent twice about 200 ms apart: `f0 09 00 00 00 00 00 00 00 00 00 00 f7`. The unit ignores id 0x09, so this editor can only be recorded against the unit with its id rewritten to 0xC1 (a patched copy of the exe, or a relay).
- In commands sent to the Surface over SSH, do not redirect output with `>nul`: it can fail with "The system cannot find the path specified" and the command before it does not run. Leave the output or filter it on the server side.
- Settle first, before mapping any other command, whether the unit answers commands only while connected: 0x22 was echoed once shortly after a connect/disconnect pair and ignored twice without one. Test 0x22 inside a connect ... disconnect session, then outside one.
- Always send disconnect (0x0f) after connect (0x00): connect may lock the front panel.
- The command numbers in `vendor/DPA480P_SerialProtocol.pdf` (gain 0x01, delay 0x02, ... mute 0x09) are a later relative of this dialect: a hypothesis for the command map, not a fact. Test reads before writes, writes only with amps off.
- In PowerShell scripts on the Surface, do not name a function `Rd` (alias for Remove-Item; it hangs waiting for input) and run with `< NUL`.
- Everything below this line is history of closed routes; the silence it describes was caused by using later-generation commands.
- iPhone over cable is closed: iOS gives apps no access to generic USB serial chips.
- No DPA240A protocol document is published. The sibling's is at `vendor/DPA480P_SerialProtocol.pdf` (115200 8N1, 13-byte frames, STX=0x8D, ID_M=0x21, ETX=0xF7).
- The editor's real settings, from `captures/cap1_connect_fail.pcap`: 9600 baud, 8N1, DTR and RTS off, no flow control. Its presence query is `f0 02 00 50 00 00 00 00 00 00 00 00 f7` (STX 0xF0, model id 0x02, device 0, command 0x50, ETX 0xF7); it sends it once and waits about 270 ms. The DPA480P document's STX 0x8D / id 0x21 / 115200 do not apply to this model.
- The unit does not answer that query: not to the editor itself, and not at any of 16 baud rates from 1200 to 921600 with DTR/RTS on or off. Until the unit answers the official editor, the fault is in the unit, its port, its state or the cable, not in our software. No app work before that.
- Probing is closed. Zero replies to all of: query 0x50 in both formats (STX 0xF0 and 0x8D), model ids 0x00-0x7F, at 9600/19200/38400/57600/115200/230400; query 0x50 with ids 0x80-0xFF at 9600; the older-generation query 0x7D (what the DPA240P v1.5.5 editor sends: `f0 aa 00 7d ... f7`, 9600 8N1, see `captures/cap2_240P_editor.pcap`) with ids 0x00-0xFF at 9600. All with DTR/RTS off. The unit shows software version V1.05; the manual expects V2.0.3 and the only published DPA240A editor is v3.1.4. Remaining explanations: a dialect none of Marani's published editors speak, or a dead link between the USB chip and the processor inside the unit. Only Marani support or a passive listen test can tell them apart; no more sweeps.
- Also zero replies: a 150 s passive listen at 9600 across a power-cycle and knob turns; both editors' real queries sent from the Mac as well as the Surface (the Surface is cleared); every single byte value 0x00-0xFF at 1200-230400 baud, with even and odd parity at 9600/19200/38400/115200. Rear-panel switch on USB and unit power-cycled for all of these.
- The unit is unbranded ("DPA240-A ... designed in Italy made in China"), software version V1.05, FTDI USB chip, rear USB/RS485 switch: an early generation of the Seed Digital / Marani design. An older DPA480 manual quotes "V1.06", and a 2020 ProSoundWeb thread (topic 174502) reports the same failure on an early 480 with Marani not answering email. The early editor is not on any site the fetch tools can reach (web.archive.org and prosoundweb are blocked).
- The editor this unit needs is almost certainly `SetupDPA240AV33.rar`: Marani's download page linked it until 28 Dec 2015, and by April 2016 listed `SetupDPA240A_96kHz_v3.1.0.rar` instead. So the v3.1.x line is the "96 kHz" hardware's editor and V33 was the earlier hardware's. Neither file is on Marani's live server under `/public/` (17 + 18 name variants tried) and the Wayback Machine did not archive V33's contents.
- Longer made-up frames (blind probe stage 2) are allowed only after the user confirms the amps are off or disconnected.
- Both Marani editors need their .NET serial library registered by hand on the Surface (their installers' `regSerialDll.bat` step does not take): copy `SeedSerialLibvN.dll` to `C:\Windows\SysWOW64` and run the 32-bit .NET 4 `regasm ... /tlb /codebase`. Done for v2 and v3.
- Decode captures with `tools/ftdi_pcap.py <file.pcap>`.
- The Windows editor (`vendor/app/app/DPA240A v3.1.4.exe`) is VB6 and takes its baud rate and frame length from code, not config; its serial layer is the generic .NET `SeedSerialLibv3.dll`. The exe's only serial setting in plain sight is the string `9600,N,8,1` (an MSComm control default); its 115200 hits are window-layout data, not a baud rate. It also ships `MSCOMM32.OCX`, so it may talk through MSComm rather than the .NET library.
- The editor bundles a CH341 USB driver, but the device on this Mac is an FTDI FT232R. The FTDI is confirmed to be the unit (port disappears when its cable is pulled).
- CMD 0x00 (request connection) locks the unit's front panel; never send it without sending 0x0F (disconnect) after.
- Amps down or disconnected before any write command is tested.
- Capture rig: Surface at `user@192.168.1.66` (SSH key login), editor installed, unit appears there as COM5, USBPcap driver installed (`USBPcapCMD.exe -d \\.\USBPcap1 -A -o file.pcap`; kill the process before copying the file). GUI is driven with `act.ps1` in `C:\Users\User\dpa` via an interactive scheduled task; the Surface must stay signed in and unlocked.
