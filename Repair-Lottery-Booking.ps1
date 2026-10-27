$ErrorActionPreference = 'Stop'

# Run this file from an Administrator PowerShell window. It repairs only a
# corrupt per-machine Lottery Booking installation; it never removes local app data.
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (!$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Administrator permission is required. Open PowerShell with Run as administrator and run this file again.'
}

if (Get-Process -Name 'Lottery Booking' -ErrorAction SilentlyContinue) {
  throw 'Lottery Booking is still running. Close it from Task Manager, then run this repair again.'
}

$appDir = 'C:\Program Files\Lottery Booking'
$uninstallRoots = @(
  'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall',
  'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall'
)
$entries = foreach ($root in $uninstallRoots) {
  Get-ChildItem -LiteralPath $root -ErrorAction SilentlyContinue | ForEach-Object {
    $entry = Get-ItemProperty -LiteralPath $_.PSPath -ErrorAction SilentlyContinue
    if ($entry.DisplayName -like 'Lottery Booking*' -and
        $entry.UninstallString -like '*\\Program Files\\Lottery Booking\\Uninstall Lottery Booking.exe*') {
      $entry
    }
  }
}

if (!$entries) {
  throw 'A matching Lottery Booking installation record was not found. No changes were made.'
}
if (!(Test-Path -LiteralPath $appDir)) {
  throw 'The expected Lottery Booking program folder was not found. No changes were made.'
}

$backupDir = "$appDir.corrupt-backup-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
Rename-Item -LiteralPath $appDir -NewName (Split-Path -Leaf $backupDir)
$entries | ForEach-Object { Remove-Item -LiteralPath $_.PSPath -Force }

Write-Host "Repair complete. Old application files are safely backed up at: $backupDir"
Write-Host 'Now run Lottery-Booking-Setup-2.9.3.exe as administrator.'
