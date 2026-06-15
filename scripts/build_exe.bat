@echo off
setlocal
rem Run from the repository root (this script lives in scripts\).
cd /d "%~dp0.."

echo ==========================================
echo GeoCoord - Build desktop (stlite + Electron)
echo ==========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js not found. Install it from https://nodejs.org/ and retry.
    pause
    exit /b 1
)

echo Installing Node dependencies...
call npm install
if errorlevel 1 goto error

echo.
echo Generating stlite artifacts (downloads Pyodide + wheels)...
call npm run dump
if errorlevel 1 goto error

echo.
echo Building the Windows installer...
call npm run app:dist
if errorlevel 1 goto error

echo.
echo Done. The installer is in the dist\ folder.
echo.
pause
exit /b 0

:error
echo.
echo [ERROR] A step failed. See the messages above.
pause
exit /b 1
