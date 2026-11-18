#!/bin/bash
# cam.sh [dev] [out.jpg]: take a photo on the Surface (0=front, 1=rear), copy it here, write a 1000px copy next to it as *_s.jpg
H=user@192.168.1.66; D=${1:-0}; O=${2:-cam.jpg}
ssh -o BatchMode=yes $H "del C:\Users\User\dpa\cam.txt 2>nul & schtasks /create /f /tn dpa_cam /sc once /st 23:59 /it /ru User /rl highest /tr \"powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File C:\Users\User\dpa\cam.ps1 -dev $D\" >nul & schtasks /run /tn dpa_cam >nul"
for i in $(seq 1 25); do sleep 1; r=$(ssh -o BatchMode=yes $H 'type C:\Users\User\dpa\cam.txt 2>nul'); [ -n "$r" ] && break; done; echo "$r" | head -2
scp -q $H:dpa/cam.jpg "$O" && python3 -I -c "import sys;from PIL import Image;im=Image.open(sys.argv[1]);im.thumbnail((1000,1000));im.save(sys.argv[1][:-4]+'_s.jpg')" "$O"
