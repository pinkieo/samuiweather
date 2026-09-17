@echo off
REM Interactive/manual. Scheduled runs use broadcast-hourly-silent.vbs (07/13/19 ICT).
setlocal
cd /d "%~dp0"
npx tsx scripts/broadcast-schedule.ts %*
