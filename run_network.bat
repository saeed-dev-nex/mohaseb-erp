@echo off
setlocal enabledelayedexpansion

set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"
set "FRONTEND=%ROOT%\frontend"
set "BACKEND=%ROOT%\backend"
set "DIST=%FRONTEND%\dist"
set "HASH_FILE=%FRONTEND%\.build_hash"

if not defined MOHASEB_SKIP_UPDATE (
    echo [INFO] Checking for project updates...
    powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\update_project.ps1"
    if errorlevel 1 echo [WARN] Update was skipped or failed. Starting the local version.
)

call "%BACKEND%\ensure_venv.bat"
if errorlevel 1 (
    pause
    exit /b 1
)

echo ============================================================
echo    Mohaseb Pro - LAN Server Mode
echo ============================================================
echo.

:: Find Local IP
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /i "IPv4"') do (
    set "RAW_IP=%%a"
    set "LOCAL_IP=!RAW_IP: =!"
    goto :ip_done
)
:ip_done

echo [INFO] Server IP Address: %LOCAL_IP%
echo [INFO] Client access: http://%LOCAL_IP%:4173
echo.

:: Smart Build: hash source, public assets, and build configuration.
echo [INFO] Checking if rebuild is needed...

:: Hash file contents, so same-size edits and service-worker changes trigger a rebuild.
set "COMBINED_HASH="
for /f "usebackq delims=" %%h in (`powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\scripts\frontend_build_hash.ps1" -FrontendPath "%FRONTEND%"`) do set "COMBINED_HASH=%%h"
if not defined COMBINED_HASH (
    echo [ERROR] Could not calculate the frontend build hash.
    pause
    exit /b 1
)

:: Read previously stored hash
set "OLD_HASH="
if exist "%HASH_FILE%" (
    set /p OLD_HASH=<"%HASH_FILE%"
)

:: Decide whether to rebuild
set "NEED_BUILD=0"
if not exist "%DIST%\index.html" set "NEED_BUILD=1"
if "!COMBINED_HASH!" NEQ "!OLD_HASH!" set "NEED_BUILD=1"

if "!NEED_BUILD!"=="0" (
    echo [OK] No changes detected - using existing build.
    echo.
    goto :start_servers
)

echo ============================================================
echo [1/2] Building Frontend (changes detected)...
echo ============================================================
echo.

cd /d "%FRONTEND%"
call npm run build
if errorlevel 1 (
    echo.
    echo [ERROR] Frontend build failed!
    pause
    exit /b 1
)

:: Save new hash
echo !COMBINED_HASH!> "%HASH_FILE%"
echo [OK] Build complete. Hash saved.
echo.

:start_servers
echo ============================================================
echo [2/2] Starting Servers...
echo ============================================================
echo.

:: Start Django Backend on all interfaces
start "Mohaseb-Backend" cmd /k "set DJANGO_ALLOWED_HOSTS=* && set DJANGO_CORS_ALLOWED_ORIGINS=http://%LOCAL_IP%:4173 && "%BACKEND%\run_backend.bat" runserver 0.0.0.0:8000"

:: Wait for backend to start
timeout /t 3 /nobreak > nul

:: Start Vite Preview on all interfaces
set "CMD_FRONTEND=cd /d %FRONTEND% && npx vite preview --host 0.0.0.0 --port 4173"
start "Mohaseb-Frontend" cmd /k "%CMD_FRONTEND%"

echo.
echo ============================================================
echo  Servers started successfully!
echo.
echo  Client access URL:
echo  ^> http://%LOCAL_IP%:4173
echo.
echo  API URL (for debug):
echo  ^> http://%LOCAL_IP%:8000/api/
echo.
echo  Close the opened windows to stop the servers.
echo ============================================================
echo.
pause
endlocal
