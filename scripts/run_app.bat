@echo off
setlocal
rem Run from the repository root (this script lives in scripts\).
cd /d "%~dp0.."

echo ==========================================
echo GeoCoord - Run (web application)
echo ==========================================
echo.

python -m pip install -r requirements.txt
if errorlevel 1 (
    echo [ERROR] Failed to install dependencies.
    pause
    exit /b 1
)

echo.
echo Starting the application...
python -m streamlit run app.py

endlocal
pause
