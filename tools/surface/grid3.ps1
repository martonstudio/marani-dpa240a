$hits=0
$p=New-Object System.IO.Ports.SerialPort "COM5",9600,"None",8,"One"
$p.DtrEnable=$false;$p.RtsEnable=$false;$p.Open();Start-Sleep -m 80
function ReadHex(){ $n=$p.BytesToRead; if($n -gt 0){$buf=New-Object byte[] $n;[void]$p.Read($buf,0,$n);return (($buf|ForEach-Object{$_.ToString('x2')}) -join ' ')}; return "" }
foreach($id in 0..255){
  $f=[byte[]](0xF0,$id,0,0x00,0,0,0,0,0,0,0,0,0xF7)
  $p.DiscardInBuffer();$p.Write($f,0,13);Start-Sleep -m 150
  $r=ReadHex
  if($r){$hits++;"HIT id=$('{0:x2}' -f $id) cmd=00 RX $r"
    $g=[byte[]](0xF0,$id,0,0x0F,0,0,0,0,0,0,0,0,0xF7);$p.Write($g,0,13);Start-Sleep -m 300;"   disconnect(0f) RX $(ReadHex)"}
}
$p.Close();"grid3 done hits=$hits"
