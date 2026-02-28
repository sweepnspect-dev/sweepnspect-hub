$action = New-ScheduledTaskAction -Execute "C:\Program Files\Git\bin\bash.exe" -Argument "D:\Hive\Projects\SweepNspect-Hub\start-hub.sh" -WorkingDirectory "D:\Hive\Projects\SweepNspect-Hub"
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
Register-ScheduledTask -TaskName "SweepNspect Hub" -Action $action -Trigger $trigger -Settings $settings -Force
Write-Host "Task registered successfully"
