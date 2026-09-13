' Hidden runner for weather-hourly.cmd. Do not Execute cmd.exe from Task Scheduler.
Option Explicit
Dim sh, root, py, cmd
Set sh = CreateObject("WScript.Shell")
root = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
py = root & "\.venv\Scripts\python.exe"
cmd = """" & py & """ """ & root & "\weather_engine_hourly.py"""
sh.CurrentDirectory = root
WScript.Quit sh.Run(cmd, 0, True)
