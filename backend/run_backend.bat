@echo off
setlocal
rem This install chooses its own database (setup wizard / its own
rem backend\.db_config.json). Ignore any DATABASE_URL / REDIS_URL
rem inherited from the machine or the calling window: it may belong
rem to another program and must not hijack this install's database.
set "DATABASE_URL="
set "REDIS_URL="
set "ROOT=%~dp0.."
set "BACKEND=%~dp0"
call "%BACKEND%ensure_venv.bat"
if errorlevel 1 exit /b 1
call "%BACKEND%first_run_setup.bat"
if errorlevel 1 exit /b 1
cd /d "%BACKEND%"
"%BACKEND_PYTHON%" manage.py %*
endlocal
