@echo off
setlocal enabledelayedexpansion

rem Mohaseb Pro - Production Mode (Windows)
rem One Daphne process serves the app, the API and websockets on a single
rem port. For the two-process development/LAN mode use run_network.bat.

set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"
set "FRONTEND=%ROOT%\frontend"
set "BACKEND=%ROOT%\backend"
set "DIST=%FRONTEND%\dist"
set "HASH_FILE=%FRONTEND%\.build_hash"
if not defined MOHASEB_PORT set "MOHASEB_PORT=8000"

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

call "%BACKEND%\first_run_setup.bat"
if errorlevel 1 (
    pause
    exit /b 1
)

:: Persistent SECRET_KEY: with DEBUG off the app refuses to start without
:: one, and a key that changes on every restart would log everyone out.
:: The generated key is kept in backend\.secret_key (never committed).
if not defined DJANGO_SECRET_KEY (
    if exist "%BACKEND%\.secret_key" (
        set /p DJANGO_SECRET_KEY=<"%BACKEND%\.secret_key"
    ) else (
        for /f "delims=" %%k in ('powershell -NoProfile -Command "$b=New-Object byte[] 48; (New-Object Security.Cryptography.RNGCryptoServiceProvider).GetBytes($b); [Convert]::ToBase64String($b)"') do set "DJANGO_SECRET_KEY=%%k"
        if defined DJANGO_SECRET_KEY (
            echo !DJANGO_SECRET_KEY!> "%BACKEND%\.secret_key"
            echo [INFO] A new SECRET_KEY was generated in backend\.secret_key - keep this file safe and private.
        )
    )
)
if not defined DJANGO_SECRET_KEY (
    echo [ERROR] DJANGO_SECRET_KEY is not set and could not be generated.
    pause
    exit /b 1
)

echo ============================================================
echo    Mohaseb Pro - Production Server Mode
echo ============================================================
echo.

:: Find Local IP
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /i "IPv4"') do (
    set "RAW_IP=%%a"
    set "LOCAL_IP=!RAW_IP: =!"
    goto :ip_done
)
:ip_done

:: Smart Build: rebuild the frontend only when its sources changed.
echo [INFO] Checking if rebuild is needed...
set "COMBINED_HASH="
for /f "usebackq delims=" %%h in (`powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\scripts\frontend_build_hash.ps1" -FrontendPath "%FRONTEND%"`) do set "COMBINED_HASH=%%h"
if not defined COMBINED_HASH (
    echo [ERROR] Could not calculate the frontend build hash.
    pause
    exit /b 1
)
set "OLD_HASH="
if exist "%HASH_FILE%" (
    set /p OLD_HASH=<"%HASH_FILE%"
)
set "NEED_BUILD=0"
if not exist "%DIST%\index.html" set "NEED_BUILD=1"
if "!COMBINED_HASH!" NEQ "!OLD_HASH!" set "NEED_BUILD=1"
if "!NEED_BUILD!"=="0" (
    echo [OK] No changes detected - using existing build.
    echo.
    goto :start_server
)
echo [INFO] Building Frontend (changes detected)...
cd /d "%FRONTEND%"
call npm run build
if errorlevel 1 (
    echo.
    echo [ERROR] Frontend build failed!
    pause
    exit /b 1
)
echo !COMBINED_HASH!> "%HASH_FILE%"
echo [OK] Build complete. Hash saved.
echo.

:start_server
set "DJANGO_DEBUG=false"
set "DJANGO_SERVE_FRONTEND=true"
if not defined DJANGO_ALLOWED_HOSTS set "DJANGO_ALLOWED_HOSTS=localhost,127.0.0.1,[::1],%LOCAL_IP%"
if not defined DJANGO_CORS_ALLOWED_ORIGINS set "DJANGO_CORS_ALLOWED_ORIGINS=http://%LOCAL_IP%:%MOHASEB_PORT%,http://localhost:%MOHASEB_PORT%,http://127.0.0.1:%MOHASEB_PORT%"

start "Mohaseb-Production" "%BACKEND%\run_production_server.bat"

echo.
echo ============================================================
echo  Production server started on a single port.
echo.
echo  Client access URL:
echo  ^> http://%LOCAL_IP%:%MOHASEB_PORT%
echo.
echo  API URL (for debug):
echo  ^> http://%LOCAL_IP%:%MOHASEB_PORT%/api/
echo.
echo  Close the Mohaseb-Production window to stop the server.
echo ============================================================
echo.
pause
endlocal
