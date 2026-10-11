@echo off
setlocal

rem Local Qt build only. This script never creates a portable directory or ZIP.
set "SOURCE_DIR=%~dp0"
set "BUILD_DIR=%PANDOEDITOR_BUILD_DIR%"
if not defined BUILD_DIR set "BUILD_DIR=%~d0\build\Pandoeditor-ui"
set "APP_EXE=%BUILD_DIR%\pandoeditor.exe"

set "QT_DIR=%PANDOEDITOR_QT_DIR%"
if not defined QT_DIR set "QT_DIR=%USERPROFILE%\Qt\6.8.3\mingw_64"
set "MINGW_DIR=%PANDOEDITOR_MINGW_DIR%"
if not defined MINGW_DIR set "MINGW_DIR=%USERPROFILE%\Qt\Tools\mingw1310_64"
if not exist "%QT_DIR%\bin\Qt6Core.dll" goto missing_qt
if not exist "%MINGW_DIR%\bin\g++.exe" goto missing_mingw
set "PATH=%MINGW_DIR%\bin;%QT_DIR%\bin;%PATH%"
set "QT_PLUGIN_PATH=%QT_DIR%\plugins"
set "QML2_IMPORT_PATH=%QT_DIR%\qml"
set "QML_IMPORT_PATH=%QT_DIR%\qml"

if /I "%~1"=="build" goto build
if not exist "%APP_EXE%" goto missing_exe
if /I "%~1"=="smoke" goto smoke
start "" /D "%BUILD_DIR%" "%APP_EXE%"
exit /b %ERRORLEVEL%

:smoke
"%APP_EXE%" --smoke-check
exit /b %ERRORLEVEL%

:build
set "CMAKE_EXE=%PANDOEDITOR_CMAKE_EXE%"
if not defined CMAKE_EXE for %%I in (cmake.exe) do set "CMAKE_EXE=%%~$PATH:I"
if not defined CMAKE_EXE set "CMAKE_EXE=%LOCALAPPDATA%\Packages\OpenAI.Codex_2p2nqsd0c76g0\LocalCache\Local\Pandoeditor\installer\Lib\site-packages\cmake\data\bin\cmake.exe"
set "NINJA_EXE=%PANDOEDITOR_NINJA_EXE%"
if not defined NINJA_EXE for %%I in (ninja.exe) do set "NINJA_EXE=%%~$PATH:I"
if not defined NINJA_EXE set "NINJA_EXE=%LOCALAPPDATA%\Packages\OpenAI.Codex_2p2nqsd0c76g0\LocalCache\Local\Pandoeditor\installer\Scripts\ninja.exe"
if not exist "%CMAKE_EXE%" goto missing_cmake
if not exist "%NINJA_EXE%" goto missing_ninja
"%CMAKE_EXE%" -S "%SOURCE_DIR%" -B "%BUILD_DIR%" -G Ninja -DCMAKE_BUILD_TYPE=Release -DBUILD_TESTING=OFF "-DCMAKE_PREFIX_PATH=%QT_DIR%" "-DCMAKE_CXX_COMPILER=%MINGW_DIR%\bin\g++.exe" "-DCMAKE_MAKE_PROGRAM=%NINJA_EXE%" "-DCMAKE_CXX_FLAGS=-Wa,-mbig-obj"
if errorlevel 1 exit /b 1
"%CMAKE_EXE%" --build "%BUILD_DIR%" --target pandoeditor --parallel 2
if errorlevel 1 exit /b 1
echo Built %APP_EXE%
exit /b 0

:missing_qt
echo Qt was not found at "%QT_DIR%". Set PANDOEDITOR_QT_DIR.
exit /b 1
:missing_mingw
echo MinGW was not found at "%MINGW_DIR%". Set PANDOEDITOR_MINGW_DIR.
exit /b 1
:missing_exe
echo No local executable at "%APP_EXE%". Run "%~nx0 build" once.
exit /b 1
:missing_cmake
echo CMake was not found. Set PANDOEDITOR_CMAKE_EXE.
exit /b 1
:missing_ninja
echo Ninja was not found. Set PANDOEDITOR_NINJA_EXE.
exit /b 1
