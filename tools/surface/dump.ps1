# dump.ps1 -from 0 -to 0x8000 -out file.bin : read unit memory with cmd 0x17 (16-bit address in D0:D1, 4 data bytes back in D2..D5).
# Connects first, always disconnects. Missing replies are written as 0xEE and listed in <out>.missing.
param([int]$from=0,[int]$to=0x100,[string]$out="C:\Users\User\dpa\mem.bin",[int]$step=4)
$p=New-Object System.IO.Ports.SerialPort "COM5",9600,"None",8,"One"; $p.DtrEnable=$false;$p.RtsEnable=$false; $p.ReadTimeout=300
try{$p.Open()}catch{Start-Sleep 1;$p.Open()}
function Xch([byte[]]$f){ $p.DiscardInBuffer(); $p.Write($f,0,13); $r=New-Object byte[] 13; $n=0
 $t=(Get-Date).AddMilliseconds(400); while($n -lt 13 -and (Get-Date) -lt $t){ if($p.BytesToRead -gt 0){ $n+=$p.Read($r,$n,13-$n) } else { Start-Sleep -m 2 } }; if($n -eq 13){,$r}else{$null} }
$ms=New-Object IO.MemoryStream; $miss=@()
try{
 $c=Xch ([byte[]](0xF0,0xC1,0,0,0,0,0,0,0,0,0,0,0xF7)); if(-not $c){ throw "no connect reply" }
 for($a=$from;$a -lt $to;$a+=$step){
  $r=Xch ([byte[]](0xF0,0xC1,0,0x17,($a -shr 8),($a -band 255),0,0,0,0,0,0,0xF7))
  if($r -and $r[3] -eq 0x17 -and $r[4] -eq ($a -shr 8) -and $r[5] -eq ($a -band 255)){ $ms.Write($r,6,$step) } else { $miss+=('{0:x4}' -f $a); $ms.Write([byte[]](0xEE,0xEE,0xEE,0xEE),0,$step) }
 }
} finally {
 $d=Xch ([byte[]](0xF0,0xC1,0,0x0F,0,0,0,0,0,0,0,0,0xF7)); $p.Close()
 [IO.File]::WriteAllBytes($out,$ms.ToArray()); $miss -join ' ' | Set-Content "$out.missing"
 "bytes {0} missing {1} disconnect {2}" -f $ms.Length,$miss.Count,($(if($d){($d|%{$_.ToString('x2')}) -join ' '}else{'NO REPLY'}))
}
