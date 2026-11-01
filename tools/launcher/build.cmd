@echo off
rem Builds ParklaneDev.exe into the project folder with the C# compiler that ships with Windows.
rem Run it from anywhere: tools\launcher\build.cmd
setlocal
set "CSC=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if not exist "%CSC%" set "CSC=%WINDIR%\Microsoft.NET\Framework\v4.0.30319\csc.exe"
if not exist "%CSC%" (
  echo The .NET Framework 4 C# compiler was not found. It ships with Windows 10 and 11.
  exit /b 1
)
"%CSC%" /nologo /optimize+ /target:exe /out:"%~dp0..\..\ParklaneDev.exe" "%~dp0ParklaneDev.cs"
if errorlevel 1 exit /b 1
echo Built %~dp0..\..\ParklaneDev.exe
