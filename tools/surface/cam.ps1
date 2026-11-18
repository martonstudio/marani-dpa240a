# cam.ps1 [-dev N]: take one photo with WinRT MediaCapture into C:\Users\User\dpa\cam.jpg; writes cam.txt (ok / error)
param([int]$dev=0,[int]$n=1,[int]$gap=3)
$out="C:\Users\User\dpa\cam.txt"
try{
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask=([System.WindowsRuntimeSystemExtensions].GetMethods()|?{$_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'})[0]
$asAct=([System.WindowsRuntimeSystemExtensions].GetMethods()|?{$_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncAction'})[0]
function Await($op,[type]$t){ $task=$asTask.MakeGenericMethod($t).Invoke($null,@($op)); $task.Wait(-1)|Out-Null; $task.Result }
function AwaitA($op){ $asAct.Invoke($null,@($op)).Wait(-1)|Out-Null }
[void][Windows.Devices.Enumeration.DeviceInformation,Windows.Devices.Enumeration,ContentType=WindowsRuntime]
[void][Windows.Media.Capture.MediaCapture,Windows.Media.Capture,ContentType=WindowsRuntime]
[void][Windows.Storage.StorageFolder,Windows.Storage,ContentType=WindowsRuntime]
[void][Windows.Media.MediaProperties.ImageEncodingProperties,Windows.Media.MediaProperties,ContentType=WindowsRuntime]
$devs=Await ([Windows.Devices.Enumeration.DeviceInformation]::FindAllAsync([Windows.Devices.Enumeration.DeviceClass]::VideoCapture)) ([Windows.Devices.Enumeration.DeviceInformationCollection])
$names=($devs|%{ "$($_.Name) [$($_.EnclosureLocation.Panel)]" }) -join '; '
$s=New-Object Windows.Media.Capture.MediaCaptureInitializationSettings; $s.VideoDeviceId=$devs[$dev].Id; $s.StreamingCaptureMode=[Windows.Media.Capture.StreamingCaptureMode]::Video
$mc=New-Object Windows.Media.Capture.MediaCapture; AwaitA ($mc.InitializeAsync($s)); Start-Sleep 2
$f=Await ([Windows.Storage.StorageFolder]::GetFolderFromPathAsync("C:\Users\User\dpa")) ([Windows.Storage.StorageFolder])
for($k=0;$k -lt $n;$k++){ $nm=$(if($n -eq 1){"cam.jpg"}else{"burst_{0:d2}.jpg" -f $k})
 $file=Await ($f.CreateFileAsync($nm,[Windows.Storage.CreationCollisionOption]::ReplaceExisting)) ([Windows.Storage.StorageFile])
 AwaitA ($mc.CapturePhotoToStorageFileAsync([Windows.Media.MediaProperties.ImageEncodingProperties]::CreateJpeg(),$file)); if($k -lt $n-1){Start-Sleep $gap} }
$mc.Dispose()
"ok dev=$dev of: $names" | Set-Content $out
}catch{ "error: $($_.Exception.ToString())" | Set-Content $out }
