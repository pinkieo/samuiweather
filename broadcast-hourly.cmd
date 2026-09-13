@echo off
REM Interactive/manual. Scheduled runs use broadcast-hourly-silent.vbs (no console flash).
setlocal
cd /d "%~dp0"
npx tsx scripts/broadcast-schedule.ts %*
