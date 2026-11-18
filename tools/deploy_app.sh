#!/bin/bash
# Build the app on server and copy it to the Surface bridge's web root (the bridge serves new files at once).
set -e
D="$(cd "$(dirname "$0")/.." && pwd)"
cd "$D/app" && npm run -s build
ssh -o BatchMode=yes user@192.168.1.66 "if exist C:\Users\User\dpa\app\dist rmdir /s /q C:\Users\User\dpa\app\dist" </dev/null
scp -q -r "$D/app/dist" user@192.168.1.66:dpa/app/dist
scp -q "$D/tools/surface/edge_app.bat" "$D/tools/surface/shortcut.ps1" user@192.168.1.66:dpa/
echo deployed
