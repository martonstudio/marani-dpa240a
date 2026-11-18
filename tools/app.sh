#!/bin/bash
# tools/app.sh <dpa cli args> : run the app's CLI against the unit through the Surface bridge.
# Opens an SSH tunnel server:8240 -> Surface localhost:8240 for the duration of the command (reuses one if open).
set -u
D="$(cd "$(dirname "$0")/.." && pwd)"
PORT=${DPA_PORT:-8240}
T=""
if ! (exec 3<>/dev/tcp/127.0.0.1/$PORT) 2>/dev/null; then
  ssh -o BatchMode=yes -o ExitOnForwardFailure=yes -N -L $PORT:localhost:8240 user@192.168.1.66 &
  T=$!
  for i in $(seq 1 40); do (exec 3<>/dev/tcp/127.0.0.1/$PORT) 2>/dev/null && break; sleep 0.25; done
fi
cd "$D/app" && npx tsx cli/dpa.ts "$@"; rc=$?
[ -n "$T" ] && kill $T 2>/dev/null
exit $rc
