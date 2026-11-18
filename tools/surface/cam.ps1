# cam.ps1 [-dev N]: take one photo with WinRT MediaCapture into C:\Users\User\dpa\cam.jpg; writes cam.txt (ok / error)
param([int]$dev=0)
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
$file=Await ($f.CreateFileAsync("cam.jpg",[Windows.Storage.CreationCollisionOption]::ReplaceExisting)) ([Windows.Storage.StorageFile])
AwaitA ($mc.CapturePhotoToStorageFileAsync([Windows.Media.MediaProperties.ImageEncodingProperties]::CreateJpeg(),$file)); $mc.Dispose()
"ok dev=$dev of: $names" | Set-Content $out
}catch{ "error: $($_.Exception.ToString())" | Set-Content $out }
