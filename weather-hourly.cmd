@echo off
REM Interactive/manual only. For a scheduled/background run use weather-hourly-silent.vbs
REM (wscript.exe //nologo //B) so no console window flashes.
REM Run ingest with a project-local venv (always use .venv\Scripts\python.exe — not global "python").
setlocal
cd /d "%~dp0"
set "PY=%~dp0.venv\Scripts\python.exe"
if not exist "%PY%" (
  echo Creating .venv in %cd%
  py -m venv .venv
  if errorlevel 1 exit /b 1
  set "PY=%~dp0.venv\Scripts\python.exe"
)
"%PY%" -m pip install -r requirements-weather-engine.txt
if errorlevel 1 exit /b 1
"%PY%" weather_engine_hourly.py
if errorlevel 1 exit /b 1
REM Lock 00/06/12/18 ICT overview to the snapshot just written (no Vercel sub-daily cron).
npx tsx scripts/forecast-overview-lock.ts
