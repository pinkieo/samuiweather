' Hidden runner for broadcast-hourly.cmd. Do not Execute cmd.exe from Task Scheduler.
Option Explicit
Dim sh, root, node, script, cmd
Set sh = CreateObject("WScript.Shell")
root = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
node = "C:\Program Files\nodejs\node.exe"
script = root & "\scripts\broadcast-schedule.ts"
cmd = """" & node & """ --import tsx """ & script & """"
sh.CurrentDirectory = root
WScript.Quit sh.Run(cmd, 0, True)
