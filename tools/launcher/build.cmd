@echo off
rem Builds ParklaneDev.exe and ParklaneAttach.exe into the project folder, from the same source,
rem with the C# compiler that ships with Windows. Run it from anywhere: tools\launcher\build.cmd
setlocal
set "CSC=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if not exist "%CSC%" set "CSC=%WINDIR%\Microsoft.NET\Framework\v4.0.30319\csc.exe"
if not exist "%CSC%" (
  echo The .NET Framework 4 C# compiler was not found. It ships with Windows 10 and 11.
  exit /b 1
)
set "OUT=%~dp0..\.."
"%CSC%" /nologo /optimize+ /target:exe /out:"%OUT%\ParklaneDev.exe" "%~dp0ParklaneDev.cs"
if errorlevel 1 exit /b 1
"%CSC%" /nologo /optimize+ /target:exe /define:ATTACH_ONLY /out:"%OUT%\ParklaneAttach.exe" "%~dp0ParklaneDev.cs"
if errorlevel 1 exit /b 1
echo Built ParklaneDev.exe and ParklaneAttach.exe in %OUT%
