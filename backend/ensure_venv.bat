@echo off
rem Resolve a working project virtual environment without relying on the
rem absolute interpreter path recorded when another machine created it.

set "VENV_DIR=%BACKEND%\.venv"
set "VENV_PYTHON=%VENV_DIR%\Scripts\python.exe"

if exist "%VENV_PYTHON%" (
    "%VENV_PYTHON%" --version >nul 2>&1
    if not errorlevel 1 goto :venv_ready
)

echo [INFO] Preparing the backend Python environment...

set "PYTHON_BOOTSTRAP="
py -3 --version >nul 2>&1
if not errorlevel 1 set "PYTHON_BOOTSTRAP=py -3"

if not defined PYTHON_BOOTSTRAP (
    python --version >nul 2>&1
    if not errorlevel 1 set "PYTHON_BOOTSTRAP=python"
)

if not defined PYTHON_BOOTSTRAP (
    echo [ERROR] Python was not found. Install Python 3 and add it to PATH,
    echo         or install the Windows Python Launcher, then run this script again.
    exit /b 1
)

if exist "%VENV_DIR%\pyvenv.cfg" (
    %PYTHON_BOOTSTRAP% -m venv --clear "%VENV_DIR%"
) else (
    %PYTHON_BOOTSTRAP% -m venv "%VENV_DIR%"
)
if errorlevel 1 (
    echo [ERROR] Could not create the backend Python environment.
    exit /b 1
)

:venv_ready
set "BACKEND_PYTHON=%VENV_PYTHON%"
rem A previous installation may have stopped before installing any packages.
rem Check every direct dependency, including Pillow's compiled image module.
call :check_dependencies
if errorlevel 1 goto :install_dependencies
rem The import probe alone cannot notice packages ADDED to
rem requirements.txt by an update: a package that was never installed
rem breaks nothing already present, so the probe and pip check both
rem pass while the new code cannot import it (this is how the
rem dj-database-url addition broke older installs). Compare a hash of
rem requirements.txt with the stamp written after the last successful
rem install, and refresh the environment when the file has changed.
call :check_requirements_stamp
if not errorlevel 1 exit /b 0
echo [INFO] requirements.txt changed since the last dependency install.

:install_dependencies
echo [INFO] Installing missing or incomplete backend dependencies...
rem Allow more time to fetch large package indexes on slow connections.
rem Autobahn's optional NVX extensions do not yet provide wheels for every
rem Python release (notably Python 3.15 on Windows).  They are a performance
rem optimization only; install the supported pure-Python implementation so
rem first-run setup does not require Visual C++ Build Tools.
setlocal
set "AUTOBAHN_USE_NVX=0"
"%BACKEND_PYTHON%" -m pip install --timeout 60 --retries 3 -r "%BACKEND%\requirements.txt"
set "PIP_INSTALL_EXIT=%ERRORLEVEL%"
endlocal & set "PIP_INSTALL_EXIT=%PIP_INSTALL_EXIT%"
if not "%PIP_INSTALL_EXIT%"=="0" (
    echo [ERROR] Could not install backend dependencies.
    echo         Check your internet connection and pip package index, then run this script again.
    exit /b 1
)

call :check_dependencies
if errorlevel 1 (
    echo [ERROR] Backend dependencies are still incomplete. Check the pip output above.
    exit /b 1
)

call :write_requirements_stamp

exit /b 0

:check_dependencies
"%BACKEND_PYTHON%" -c "import django, rest_framework, rest_framework_simplejwt, corsheaders, cryptography, openpyxl, whitenoise, boto3, botocore, dj_database_url, psycopg, channels, channels_redis, daphne, redis; from PIL import Image; assert django.VERSION >= (4, 2)" >nul 2>&1
if errorlevel 1 exit /b 1
"%BACKEND_PYTHON%" -m pip check >nul 2>&1
exit /b %errorlevel%

:check_requirements_stamp
"%BACKEND_PYTHON%" -c "import hashlib, pathlib, sys; req = pathlib.Path(r'%BACKEND%requirements.txt'); stamp = pathlib.Path(r'%VENV_DIR%\.requirements.sha256'); current = hashlib.sha256(req.read_bytes()).hexdigest(); sys.exit(0 if stamp.exists() and stamp.read_text(encoding='utf-8').strip() == current else 1)" >nul 2>&1
exit /b %errorlevel%

:write_requirements_stamp
"%BACKEND_PYTHON%" -c "import hashlib, pathlib; req = pathlib.Path(r'%BACKEND%requirements.txt'); stamp = pathlib.Path(r'%VENV_DIR%\.requirements.sha256'); stamp.write_text(hashlib.sha256(req.read_bytes()).hexdigest(), encoding='utf-8')" >nul 2>&1
exit /b 0
