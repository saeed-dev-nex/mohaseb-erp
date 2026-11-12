@echo off
setlocal

set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"
set "FRONTEND=%ROOT%\frontend"
set "BACKEND=%ROOT%\backend"

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

echo ========================================================
echo Mohaseb Pro - Interactive Runner
echo ========================================================
echo Select a mode:
echo 1. dev    (Development mode with hot-reload)
echo 2. start  (Production mode using built app)
echo 3. deploy (Build the app and run migrations)
echo 4. lan    (LAN Network Server mode)
echo ========================================================

set /p user_input="Enter mode (dev/start/deploy/lan) [default: dev]: "

if "%user_input%"=="" set user_input=dev

IF /I "%user_input%"=="dev" GOTO dev
IF /I "%user_input%"=="start" GOTO start
IF /I "%user_input%"=="deploy" GOTO deploy
IF /I "%user_input%"=="lan" GOTO lan
IF /I "%user_input%"=="1" GOTO dev
IF /I "%user_input%"=="2" GOTO start
IF /I "%user_input%"=="3" GOTO deploy
IF /I "%user_input%"=="4" GOTO lan

echo Error: Invalid mode!
pause
goto end

:dev
echo Starting Development Servers...
set "CMD_FE_DEV=cd /d %FRONTEND% && npm run dev"
start "Mohaseb Backend (Dev)" cmd /k ""%BACKEND%\run_backend.bat" runserver"
start "Mohaseb Frontend (Dev)" cmd /k "%CMD_FE_DEV%"
echo Dev servers started in new windows.
goto end

:start
echo Starting Application (Production Build)...
set "CMD_FE_PREV=cd /d %FRONTEND% && npm run preview"
start "Mohaseb Backend" cmd /k ""%BACKEND%\run_backend.bat" runserver"
start "Mohaseb Frontend (Preview)" cmd /k "%CMD_FE_PREV%"
echo App started.
goto end

:deploy
echo Preparing for deployment...
echo ------------------------------------------
echo [1/2] Building Frontend (React)
cd /d "%FRONTEND%"
call npm run build
cd /d "%ROOT%"
echo ------------------------------------------
echo [2/2] Running Backend Migrations
cd /d "%BACKEND%"
call "%BACKEND%\first_run_setup.bat"
if errorlevel 1 (
    echo [ERROR] Backend first-run setup failed.
    pause
    goto end
)
cd /d "%ROOT%"
echo ========================================================
echo Build finished successfully!
echo ========================================================
pause
goto end

:lan
echo Launching LAN server mode...
set "MOHASEB_SKIP_UPDATE=1"
call "%ROOT%\run_network.bat"
goto end

:end
endlocal
