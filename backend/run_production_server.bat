@echo off
setlocal
rem Production server: Daphne (ASGI) serving API + websockets + the built
rem frontend on a single port. Started by run_production.bat at the repo
rem root, which sets the DJANGO_* environment before launching this script.
set "BACKEND=%~dp0"
call "%BACKEND%ensure_venv.bat"
if errorlevel 1 exit /b 1
if not defined MOHASEB_PORT set "MOHASEB_PORT=8000"
cd /d "%BACKEND%"
"%BACKEND_PYTHON%" -m daphne -b 0.0.0.0 -p %MOHASEB_PORT% core.asgi:application
endlocal
