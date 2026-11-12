@echo off
setlocal
set "BACKEND=%~dp0"

call "%BACKEND%ensure_venv.bat"
if errorlevel 1 exit /b 1

cd /d "%BACKEND%"
"%BACKEND_PYTHON%" manage.py migrate --noinput
if errorlevel 1 (
    echo [ERROR] Database migrations failed.
    exit /b 1
)

"%BACKEND_PYTHON%" manage.py ensure_admin
if errorlevel 1 (
    echo [ERROR] Could not check or create the administrator account.
    exit /b 1
)
endlocal