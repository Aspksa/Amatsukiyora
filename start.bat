@echo off
setlocal DisableDelayedExpansion
title Amatsukiyora
pushd "%~dp0"
if errorlevel 1 goto badfolder
set "PYTHONUTF8=1"
set "CHECK="
if /i "%~1"=="--check" set "CHECK=--check"
if exist "python\python.exe" (
    "python\python.exe" -c "import sys,sqlite3; assert sys.version_info >= (3,10)" >nul 2>&1
    if not errorlevel 1 goto portable
)
where py.exe >nul 2>&1
if errorlevel 1 goto try_python
py -3 -c "import sys,sqlite3; assert sys.version_info >= (3,10)" >nul 2>&1
if not errorlevel 1 goto launcher
:try_python
where python.exe >nul 2>&1
if errorlevel 1 goto missing
python -c "import sys,sqlite3; assert sys.version_info >= (3,10)" >nul 2>&1
if errorlevel 1 goto missing
python -u launch.py %CHECK%
goto finished
:launcher
py -3 -u launch.py %CHECK%
goto finished
:portable
"python\python.exe" -u launch.py %CHECK%
:finished
set "RC=%ERRORLEVEL%"
if "%RC%"=="0" goto done
echo Startup failed. See errors above and logs\startup.log.
goto fail
:missing
echo Python 3.10 or newer with SQLite is required.
echo Install Python or place a working portable Python in python\python.exe.
set "RC=1"
:fail
if not defined CHECK pause
:done
popd
exit /b %RC%
:badfolder
echo Cannot open project folder.
if /i not "%~1"=="--check" pause
exit /b 1
