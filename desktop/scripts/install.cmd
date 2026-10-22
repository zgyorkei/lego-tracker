@echo off
rem Installs Brick Tracker for the current user. No admin rights needed.
rem Copies the app to %LOCALAPPDATA%\Programs\Brick Tracker, then starts it
rem once with --install, which adds the Start menu shortcut and the
rem start-with-Windows entry (needed for the daily 4AM refresh).
rem Quit Brick Tracker from its tray icon before re-running this to update.

setlocal
set "SRC=%~dp0Brick Tracker-win32-x64"
set "DEST=%LOCALAPPDATA%\Programs\Brick Tracker"

if not exist "%SRC%\Brick Tracker.exe" (
  echo Could not find "%SRC%". Run this from the unzipped folder.
  exit /b 1
)

echo Installing Brick Tracker to "%DEST%"...
robocopy "%SRC%" "%DEST%" /MIR /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 (
  echo Copy failed. Is Brick Tracker still running? Quit it from the tray and try again.
  exit /b 1
)

if not exist "%APPDATA%\Brick Tracker\oauth-client.json" (
  echo.
  echo Note: sign-in needs the Google OAuth client file at
  echo   "%APPDATA%\Brick Tracker\oauth-client.json"
  echo and teaching new price sources needs GEMINI_API_KEY in
  echo   "%APPDATA%\Brick Tracker\.env"
  echo See desktop\README.md in the repository.
)

rem Terminals inside VS Code export ELECTRON_RUN_AS_NODE=1, which would make
rem the app run as plain Node and exit at once.
set "ELECTRON_RUN_AS_NODE="
start "" "%DEST%\Brick Tracker.exe" --install
echo Done. Brick Tracker is starting.
endlocal
