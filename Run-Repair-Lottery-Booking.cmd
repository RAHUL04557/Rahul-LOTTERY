@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Repair-Lottery-Booking.ps1"
echo.
pause
