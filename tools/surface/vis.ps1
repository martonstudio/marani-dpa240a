# vis.ps1: timed visual check. connect, hold 20 s, mute chn 0..11 one per 2 s, hold 15 s, unmute all, disconnect. Logs every exchange.
$log="C:\Users\User\dpa\vis_$(Get-Date -f HHmmss).log"
$p=New-Object System.IO.Ports.SerialPort "COM5",9600,"None",8,"One"; $p.DtrEnable=$false;$p.RtsEnable=$false
try{$p.Open()}catch{Start-Sleep 1;$p.Open()}
function X([byte[]]$f){ $p.DiscardInBuffer(); $p.Write($f,0,13); Start-Sleep -m 300; $n=$p.BytesToRead; $r='(nothing)'
 if($n -gt 0){$b=New-Object byte[] $n;[void]$p.Read($b,0,$n);$r=($b|%{$_.ToString('x2')}) -join ' '}
 $l="{0} TX {1} | RX {2}" -f (Get-Date -f 'HH:mm:ss.fff'),(($f|%{$_.ToString('x2')}) -join ' '),$r; Add-Content $log $l; $l }
function M($c,$v){ X ([byte[]](0xF0,0xC1,0,0x09,$c,0,0,0,0,0,0,$v,0xF7)) }
try{
 X ([byte[]](0xF0,0xC1,0,0,0,0,0,0,0,0,0,0,0xF7)); Start-Sleep 20
 for($c=0;$c -le 11;$c++){ M $c 1; Start-Sleep -m 1700 }
 Start-Sleep 15
 for($c=0;$c -le 11;$c++){ M $c 0; Start-Sleep -m 700 }
} finally { X ([byte[]](0xF0,0xC1,0,0x0F,0,0,0,0,0,0,0,0,0xF7)); $p.Close() }
