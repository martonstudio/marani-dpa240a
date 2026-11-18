# usage: act.ps1 <action> [args]   actions: shot | click x y | dclick x y | type text | clicktype "x,y" keys | key keys
param([string]$a="shot",[string]$p1="",[string]$p2="")
Add-Type -AssemblyName System.Windows.Forms,System.Drawing
Add-Type @"
using System;using System.Runtime.InteropServices;
public class W{[DllImport("user32.dll")]public static extern bool SetProcessDPIAware();
[DllImport("user32.dll")]public static extern bool SetCursorPos(int x,int y);
[DllImport("user32.dll")]public static extern void mouse_event(uint f,uint dx,uint dy,uint d,UIntPtr e);}
"@
[W]::SetProcessDPIAware() | Out-Null
function Click($x,$y){[W]::SetCursorPos($x,$y)|Out-Null;Start-Sleep -m 120;[W]::mouse_event(2,0,0,0,[UIntPtr]::Zero);Start-Sleep -m 60;[W]::mouse_event(4,0,0,0,[UIntPtr]::Zero)}
switch($a){
 "click"{Click ([int]$p1) ([int]$p2)}
 "dclick"{Click ([int]$p1) ([int]$p2);Start-Sleep -m 80;Click ([int]$p1) ([int]$p2)}
 "clicktype"{$xy=$p1 -split ',';Click ([int]$xy[0]) ([int]$xy[1]);Start-Sleep -m 300;[System.Windows.Forms.SendKeys]::SendWait($p2)}
 "type"{[System.Windows.Forms.SendKeys]::SendWait($p1)}
 "run"{Start-Process -FilePath $p1 -WorkingDirectory (Split-Path $p1)}
}
Start-Sleep -m ([int](@{shot=0;run=4000}[$a] + 700))
$b=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp=New-Object System.Drawing.Bitmap $b.Width,$b.Height
$g=[System.Drawing.Graphics]::FromImage($bmp);$g.CopyFromScreen($b.Left,$b.Top,0,0,$bmp.Size)
$small=New-Object System.Drawing.Bitmap $bmp,([int]($b.Width/2)),([int]($b.Height/2))
$small.Save("C:\Users\User\dpa\shot.png");"$($b.Width)x$($b.Height)" | Set-Content C:\Users\User\dpa\shot.txt
