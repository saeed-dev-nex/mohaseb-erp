@echo off
setlocal
rem Never migrate another program's database: ignore any inherited
rem DATABASE_URL / REDIS_URL (see run_backend.bat).
set "DATABASE_URL="
set "REDIS_URL="
set "BACKEND=%~dp0"

call "%BACKEND%ensure_venv.bat"
if errorlevel 1 exit /b 1

cd /d "%BACKEND%"
"%BACKEND_PYTHON%" manage.py migrate --noinput
if errorlevel 1 (
    echo [ERROR] Database migrations failed.
    exit /b 1
)
endlocal