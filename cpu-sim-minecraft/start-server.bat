@echo off
REM Starts the CPU Scheduling Simulator with XAMPP's PHP on http://localhost:8080
REM Make sure MySQL is running (XAMPP Control Panel -> MySQL -> Start) for MySQL history.
cd /d "%~dp0"
set PHP=C:\xampp\php\php.exe
if not exist "%PHP%" set PHP=php
echo Open http://localhost:8080 in your browser. Press Ctrl+C to stop.
"%PHP%" -S 127.0.0.1:8080 -t .
