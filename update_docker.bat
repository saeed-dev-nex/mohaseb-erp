@echo off
rem Mohaseb ERP - one-command Docker update (run on the HOST).
rem Pulls the latest code, rebuilds the images and restarts the
rem services; the app is back on its own when the health check passes.
setlocal
cd /d %~dp0

echo [1/3] Receiving the latest code...
git pull
if errorlevel 1 goto :fail

echo [2/3] Rebuilding and restarting the services...
docker compose up -d --build
if errorlevel 1 goto :fail

echo [3/3] Waiting for the app to come back...
powershell -NoProfile -Command "$u='http://localhost:8000/api/setup/status/'; for($i=0;$i -lt 60;$i++){ try { $r=Invoke-WebRequest -UseBasicParsing -Uri $u -TimeoutSec 3; if($r.StatusCode -eq 200){ Write-Host 'Update done - the app is up.'; exit 0 } } catch {}; Start-Sleep -Seconds 3 }; exit 1"
if errorlevel 1 goto :slow
goto :done

:slow
echo The services are still starting; check "docker compose logs -f backend" and open the app in a minute.
goto :done

:fail
echo Update failed - see the messages above. Nothing was removed; your data volume is untouched.

:done
pause
endlocal
