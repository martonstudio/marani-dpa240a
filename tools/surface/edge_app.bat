@rem Opens the DPA app in Edge as an app window with its own profile; debugging port 9222 (localhost only) lets server drive it.
start "" "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --user-data-dir=C:\Users\User\dpa\edge-profile --remote-debugging-port=9222 --no-first-run --start-maximized --app=http://localhost:8240/
