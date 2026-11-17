#!/bin/bash
# act.sh <action> [p1] [p2] : run a GUI action in the Surface's desktop session, fetch screenshot (half-size)
S="$(cd "$(dirname "$0")" && pwd)"; H=user@192.168.1.66
A="$1"; P1="$2"; P2="$3"
ssh -o BatchMode=yes $H "del C:\Users\User\dpa\shot.txt 2>nul & schtasks /create /f /tn dpa_act /sc once /st 23:59 /it /ru User /rl highest /tr \"powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File C:\Users\User\dpa\act.ps1 $A \\\"$P1\\\" \\\"$P2\\\"\" >nul & schtasks /run /tn dpa_act >nul"
for i in 1 2 3 4 5 6 7 8 9 10 11 12; do sleep 1; ssh -o BatchMode=yes $H 'type C:\Users\User\dpa\shot.txt 2>nul' | grep -q x && break; done
scp -q -o BatchMode=yes $H:dpa/shot.png "$S/shot.png" && ssh -o BatchMode=yes $H 'type C:\Users\User\dpa\shot.txt'
