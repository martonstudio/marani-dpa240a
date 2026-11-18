# Creates the "DPA Control" desktop shortcut: Edge app window on the bridge's page (the bridge task must be running).
$s=(New-Object -ComObject WScript.Shell).CreateShortcut("$env:USERPROFILE\Desktop\DPA Control.lnk")
$s.TargetPath="C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$s.Arguments="--user-data-dir=C:\Users\User\dpa\edge-profile --remote-debugging-port=9222 --no-first-run --start-maximized --app=http://localhost:8240/"
$s.IconLocation="C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe,0"
$s.Description="DPA240A control app"
$s.Save(); "shortcut saved"
