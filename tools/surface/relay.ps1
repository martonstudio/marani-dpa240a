# TCP relay: editor (TCP mode, 127.0.0.1:Port) <-> unit on COM5. Rewrites model id FromId <-> ToId.
# Also rewrites the device byte DevFrom <-> DevTo (TCP mode uses dev 1, USB uses dev 0).
# -ReplyId: also rewrite the model id the unit returns in the connect reply data (byte 4) to FromId.
# -FromId -1: learn the editor's model id from its first frame.
# -Fake N: answer the editor's 0x1a device-search frames in the relay (variant N, see FakeReply), never forward them to COM5.
# -Hold (with -Fake): also answer every other editor frame except connect/disconnect locally; nothing but 0x00/0x0f reaches COM5.
# -Raw: only log what the editor sends, never open COM5. Always sends disconnect (0x0f) on exit if connected.
param([string]$Bind="127.168.0.101",[int]$Port=1001,[switch]$Raw,[int]$Secs=180,[int]$FromId=9,[int]$ToId=193,[string]$Tag="relay",[int]$DevFrom=1,[int]$DevTo=0,[switch]$ReplyId,[int]$Fake=-1,[switch]$Hold)
$log="C:\Users\User\dpa\${Tag}_$(Get-Date -f HHmmss).log"
function Lg($d,$b){ Add-Content $log ("{0} {1} {2}" -f (Get-Date -f 'HH:mm:ss.fff'),$d,(($b|ForEach-Object{$_.ToString('x2')}) -join ' ')) }
function FakeReply($f){ $r=[byte[]]$f.Clone(); switch($Fake){ 0{} }; ,$r }
function Fix($b,$from,$to,$df,$dt){ for($i=0;$i -lt $b.Length-2;$i++){ if($b[$i] -eq 0xF0 -and $b[$i+1] -eq $from){$b[$i+1]=$to; if($b[$i+2] -eq $df){$b[$i+2]=$dt}} }; ,$b }
$l=New-Object Net.Sockets.TcpListener([Net.IPAddress]::Parse($Bind),$Port); $l.Start()
$end=(Get-Date).AddSeconds($Secs)
while(-not $l.Pending()){ if((Get-Date) -gt $end){Add-Content $log "no connection";$l.Stop();exit}; Start-Sleep -m 50 }
$c=$l.AcceptTcpClient(); $s=$c.GetStream(); Add-Content $log "accepted"
$p=$null; $conn=$false
if(-not $Raw){ $p=New-Object System.IO.Ports.SerialPort "COM5",9600,"None",8,"One"; $p.DtrEnable=$false;$p.RtsEnable=$false;$p.Open() }
try{
 while((Get-Date) -lt $end){
  if($s.DataAvailable){
   $buf=New-Object byte[] 4096; $n=$s.Read($buf,0,4096); if($n -le 0){break}
   $b=$buf[0..($n-1)]; Lg 'E>' $b; if($FromId -lt 0 -and $b[0] -eq 0xF0){$FromId=$b[1]; Add-Content $log ('editor model id 0x{0:x2}' -f $FromId)}
   if($Fake -ge 0){ $keep=@(); for($i=0;$i -lt $b.Length;$i++){ if($b[$i] -eq 0xF0 -and $i+12 -lt $b.Length -and ($b[$i+3] -eq 0x1A -or ($Hold -and $b[$i+3] -ne 0 -and $b[$i+3] -ne 15))){ $r=FakeReply ([byte[]]$b[$i..($i+12)]); $s.Write($r,0,13); Lg '>E(fake)' $r; $i+=12 } else { $keep+=$b[$i] } }; $b=[byte[]]$keep; if($b.Length -eq 0){continue} }
   if($p){ $b=Fix $b $FromId $ToId $DevFrom $DevTo; for($i=0;$i -lt $b.Length-3;$i++){ if($b[$i] -eq 0xF0){ if($b[$i+3] -eq 0){$conn=$true}elseif($b[$i+3] -eq 15){$conn=$false} } }
     $p.Write([byte[]]$b,0,$b.Length); Lg '>U' $b }
  }
  if($p -and $p.BytesToRead -gt 0){
   Start-Sleep -m 30; $m=$p.BytesToRead; $rb=New-Object byte[] $m; [void]$p.Read($rb,0,$m); Lg 'U>' $rb
   $o=Fix $rb $ToId $FromId $DevTo $DevFrom; if($ReplyId){ for($i=0;$i -le $o.Length-5;$i++){ if($o[$i] -eq 0xF0 -and $o[$i+3] -eq 0 -and $o[$i+4] -eq $ToId){$o[$i+4]=$FromId} } }; $s.Write([byte[]]$o,0,$o.Length); Lg '>E' $o
  }
  if($c.Client.Poll(0,[Net.Sockets.SelectMode]::SelectRead) -and $c.Client.Available -eq 0){ Add-Content $log "editor closed"; break }
  Start-Sleep -m 10
 }
} finally {
 if($p){ if($conn){ $d=[byte[]](0xF0,$ToId,0,0x0F,0,0,0,0,0,0,0,0,0xF7); $p.Write($d,0,13); Lg '>U(exit disconnect)' $d; Start-Sleep -m 300; if($p.BytesToRead -gt 0){$m=$p.BytesToRead;$rb=New-Object byte[] $m;[void]$p.Read($rb,0,$m);Lg 'U>' $rb} }; $p.Close() }
 $c.Close(); $l.Stop(); Add-Content $log "done"
}
