# seq.ps1 -frames "hex;hex;..." : send frames in one port session, print each reply. Sends disconnect at the end if a connect (cmd 0x00) was sent and no disconnect followed.
param([string]$frames,[int]$wait=400)
$p=New-Object System.IO.Ports.SerialPort "COM5",9600,"None",8,"One"
$p.DtrEnable=$false;$p.RtsEnable=$false
try{$p.Open()}catch{Start-Sleep 1;$p.Open()}
Start-Sleep -m 80;$p.DiscardInBuffer();$conn=$false
function Snd($hex){$f=[byte[]]($hex.Trim() -split ' ' | ForEach-Object{[Convert]::ToByte($_,16)})
 $p.Write($f,0,$f.Length);Start-Sleep -m $wait;$n=$p.BytesToRead;$r="(nothing)"
 if($n -gt 0){$b=New-Object byte[] $n;[void]$p.Read($b,0,$n);$r=($b|ForEach-Object{$_.ToString("x2")}) -join " "}
 "{0} TX {1}" -f (Get-Date -f 'HH:mm:ss.fff'),$hex.Trim(); "{0} RX {1}" -f (Get-Date -f 'HH:mm:ss.fff'),$r; ,$f}
try{ foreach($h in $frames -split ';'){ $f=Snd $h; $out=$f[0..($f.Length-2)]; $out; $c=$f[-1][3]; if($c -eq 0){$conn=$true}elseif($c -eq 15){$conn=$false} } }
finally{ if($conn){ Snd "f0 c1 00 0f 00 00 00 00 00 00 00 00 f7" | Select -First 2 }; $p.Close() }
