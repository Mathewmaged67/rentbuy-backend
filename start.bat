@echo off
cd /d "%~dp0"
echo ============================================
echo  RentBuy Backend Launcher
echo ============================================
echo.

:: Check if node_modules exists
if not exist "node_modules\" (
  echo [1/3] Installing dependencies...
  npm install
  if errorlevel 1 (
    echo ERROR: npm install failed. Make sure Node.js is installed.
    pause
    exit /b 1
  )
) else (
  echo [1/3] Dependencies already installed. Skipping npm install.
)

echo.
echo [2/3] Setting up database (safe to re-run - uses CREATE IF NOT EXISTS)...
node setup.js
if errorlevel 1 (
  echo WARNING: Database setup failed. Check your .env DB_ settings and make sure MySQL is running.
  echo          The server will still start but may not work correctly.
)

echo.
echo [3/3] Starting server on http://localhost:5000 ...
echo Press Ctrl+C to stop the server.
echo.
node server.js
pause
