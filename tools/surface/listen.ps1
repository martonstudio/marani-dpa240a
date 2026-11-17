param([int]$secs=150,[int]$baud=9600)
$p=New-Object System.IO.Ports.SerialPort "COM5",$baud,"None",8,"One"
$p.DtrEnable=$false;$p.RtsEnable=$false;$p.Open();$p.DiscardInBuffer()
$sw=[Diagnostics.Stopwatch]::StartNew();$tot=0
while($sw.Elapsed.TotalSeconds -lt $secs){
  $n=$p.BytesToRead
  if($n -gt 0){$buf=New-Object byte[] $n;[void]$p.Read($buf,0,$n);$tot+=$n
    "{0,6:n1}s RX {1}" -f $sw.Elapsed.TotalSeconds,(($buf|ForEach-Object{$_.ToString('x2')}) -join ' ')}
  Start-Sleep -m 50
}
$p.Close();"listen done: $tot bytes in $secs s at $baud baud"
