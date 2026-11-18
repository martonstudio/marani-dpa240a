# vtest.ps1 -tests "name|set hex|restore hex;..." : for each test: snapshot live memory 0x0000-0x015F (cmd 0x17), send set, snapshot, send restore, snapshot.
# Prints the echo of each frame and the byte diffs (before->after set, before->after restore). One connect session; always disconnects.
param([string]$tests,[int]$top=0x160)
$p=New-Object System.IO.Ports.SerialPort "COM5",9600,"None",8,"One"; $p.DtrEnable=$false;$p.RtsEnable=$false
try{$p.Open()}catch{Start-Sleep 1;$p.Open()}
function Xch([byte[]]$f){ $p.DiscardInBuffer(); $p.Write($f,0,13); $r=New-Object byte[] 13; $n=0
 $t=(Get-Date).AddMilliseconds(500); while($n -lt 13 -and (Get-Date) -lt $t){ if($p.BytesToRead -gt 0){ $n+=$p.Read($r,$n,13-$n) } else { Start-Sleep -m 2 } }; if($n -eq 13){,$r}else{$null} }
function Hx($b){ if($b){($b|%{$_.ToString('x2')}) -join ' '}else{'(nothing)'} }
function Bt($s){ ,[byte[]]($s.Trim() -split ' ' | %{[Convert]::ToByte($_,16)}) }
function Snap{ $m=New-Object byte[] $top; for($a=0;$a -lt $top;$a+=4){ $r=Xch ([byte[]](0xF0,0xC1,0,0x17,($a -shr 8),($a -band 255),0,0,0,0,0,0,0xF7)); if($r -and $r[3] -eq 0x17){ [Array]::Copy($r,6,$m,$a,4) } else { for($i=0;$i -lt 4;$i++){$m[$a+$i]=0xEE} } }; ,$m }
function Dif2($x,$y){ $d=@(); for($i=0;$i -lt $x.Length;$i++){ if($x[$i] -ne $y[$i]){ $d+=('{0:x4}:{1:x2}->{2:x2}' -f $i,$x[$i],$y[$i]) } }; if($d){$d -join ' '}else{'none'} }
try{
 "connect RX " + (Hx (Xch ([byte[]](0xF0,0xC1,0,0,0,0,0,0,0,0,0,0,0xF7))))
 foreach($t in $tests -split ';'){ $n,$s,$r=$t -split '\|'
  $b0=Snap; $e1=Xch (Bt $s); $b1=Snap; $e2=Xch (Bt $r); $b2=Snap
  "== $n"; "  set     TX $($s.Trim()) RX $(Hx $e1)"; "  diff    $(Dif2 $b0 $b1)"; "  restore TX $($r.Trim()) RX $(Hx $e2)"; "  residue $(Dif2 $b0 $b2)" }
} finally { "disconnect RX " + (Hx (Xch ([byte[]](0xF0,0xC1,0,0x0F,0,0,0,0,0,0,0,0,0xF7)))); $p.Close() }
