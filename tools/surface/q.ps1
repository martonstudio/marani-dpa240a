param([string]$hex="f0 02 00 50 00 00 00 00 00 00 00 00 f7",[int]$wait=500)
$f=[byte[]]($hex -split ' ' | ForEach-Object{[Convert]::ToByte($_,16)})
$p=New-Object System.IO.Ports.SerialPort "COM5",9600,"None",8,"One"
$p.DtrEnable=$false;$p.RtsEnable=$false;$p.Open();Start-Sleep -m 80;$p.DiscardInBuffer()
$p.Write($f,0,$f.Length);Start-Sleep -m $wait
$n=$p.BytesToRead;$r="(nothing)"
if($n -gt 0){$buf=New-Object byte[] $n;[void]$p.Read($buf,0,$n);$r=($buf|ForEach-Object{$_.ToString("x2")}) -join " "}
$p.Close();"TX $hex";"RX $r"
