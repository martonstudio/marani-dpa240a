#!/bin/bash
# Build the app and install it with the bridge on a Raspberry Pi (or any Linux box with systemd and python3).
# Usage: tools/deploy_pi.sh <user@host> [serial device, default: the first FTDI adapter under /dev/serial/by-id]
# Needs passwordless sudo on the target for the service file. Safe to re-run: it replaces the files and restarts.
set -e
T="${1:?usage: deploy_pi.sh user@host [serial device]}"
D="$(cd "$(dirname "$0")/.." && pwd)"
cd "$D/app" && npm run -s build
U=$(ssh -o BatchMode=yes "$T" 'id -un')
SERIAL="${2:-$(ssh -o BatchMode=yes "$T" 'ls /dev/serial/by-id/*FTDI* 2>/dev/null | head -1')}"
SERIAL="${SERIAL:-/dev/ttyUSB0}"
ssh -o BatchMode=yes "$T" 'mkdir -p ~/dpa && rm -rf ~/dpa/dist.new'
scp -q -r "$D/app/dist" "$T:dpa/dist.new"
scp -q "$D/app/bridge/bridge.py" "$T:dpa/bridge.py"
sed -e "s|%USER%|$U|g" -e "s|%SERIAL%|$SERIAL|g" "$D/tools/pi/dpa-bridge.service" | ssh -o BatchMode=yes "$T" 'cat > ~/dpa/dpa-bridge.service'
ssh -o BatchMode=yes "$T" 'set -e; cd ~/dpa; rm -rf dist.old; [ -d dist ] && mv dist dist.old; mv dist.new dist
  sudo install -m 644 dpa-bridge.service /etc/systemd/system/dpa-bridge.service
  sudo systemctl daemon-reload; sudo systemctl enable -q dpa-bridge; sudo systemctl restart dpa-bridge
  sleep 2; systemctl is-active dpa-bridge; python3 -c "import urllib.request;print(urllib.request.urlopen(\"http://127.0.0.1:8240/api/status\",timeout=3).read().decode())"'
echo "deployed: http://${T#*@}:8240/  (serial $SERIAL)"
