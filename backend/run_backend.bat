@echo off
setlocal
set "ROOT=%~dp0.."
set "BACKEND=%~dp0"
call "%BACKEND%ensure_venv.bat"
if errorlevel 1 exit /b 1
call "%BACKEND%first_run_setup.bat"
if errorlevel 1 exit /b 1
cd /d "%BACKEND%"
"%BACKEND_PYTHON%" manage.py %*
endlocal
