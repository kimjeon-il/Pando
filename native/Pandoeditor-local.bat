@echo off
setlocal

rem Local Qt build only. This script never creates a portable directory or ZIP.
rem A quoted path ending in backslash escapes the closing quote for CMake.
set "SOURCE_DIR=%~dp0."
for %%I in ("%~dp0..") do set "WORKTREE_ROOT=%%~fI"
set "BUILD_DIR=%PANDOEDITOR_BUILD_DIR%"
if not defined BUILD_DIR set "BUILD_DIR=%WORKTREE_ROOT%\build-native\Pandoeditor-ui"
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
if /I "%~1"=="smoke" goto smoke
if not exist "%APP_EXE%" goto build_then_run
:run
start "" /D "%BUILD_DIR%" "%APP_EXE%"
exit /b %ERRORLEVEL%

:smoke
if not exist "%APP_EXE%" goto missing_exe
"%APP_EXE%" --smoke-check
exit /b %ERRORLEVEL%

:build_then_run
echo No local executable at "%APP_EXE%". Building it now.
set "RUN_AFTER_BUILD=1"
goto build

:build
set "ZLIB_DIR=%MINGW_DIR%\x86_64-w64-mingw32"
if not exist "%ZLIB_DIR%\include\zlib.h" goto missing_zlib
if not exist "%ZLIB_DIR%\lib\libz.a" goto missing_zlib
set "CMAKE_EXE=%PANDOEDITOR_CMAKE_EXE%"
if not defined CMAKE_EXE for %%I in (cmake.exe) do set "CMAKE_EXE=%%~$PATH:I"
if not defined CMAKE_EXE set "CMAKE_EXE=%LOCALAPPDATA%\Packages\OpenAI.Codex_2p2nqsd0c76g0\LocalCache\Local\Pandoeditor\installer\Lib\site-packages\cmake\data\bin\cmake.exe"
set "NINJA_EXE=%PANDOEDITOR_NINJA_EXE%"
if not defined NINJA_EXE for %%I in (ninja.exe) do set "NINJA_EXE=%%~$PATH:I"
if not defined NINJA_EXE set "NINJA_EXE=%LOCALAPPDATA%\Packages\OpenAI.Codex_2p2nqsd0c76g0\LocalCache\Local\Pandoeditor\installer\Scripts\ninja.exe"
if not exist "%CMAKE_EXE%" goto missing_cmake
if not exist "%NINJA_EXE%" goto missing_ninja
"%CMAKE_EXE%" -S "%SOURCE_DIR%" -B "%BUILD_DIR%" -G Ninja -DCMAKE_BUILD_TYPE=Release -DBUILD_TESTING=OFF "-DCMAKE_PREFIX_PATH=%QT_DIR%" "-DCMAKE_CXX_COMPILER=%MINGW_DIR%\bin\g++.exe" "-DCMAKE_MAKE_PROGRAM=%NINJA_EXE%" "-DCMAKE_CXX_FLAGS=-Wa,-mbig-obj" "-DZLIB_INCLUDE_DIR=%ZLIB_DIR%\include" "-DZLIB_LIBRARY=%ZLIB_DIR%\lib\libz.a"
if errorlevel 1 goto build_failed
"%CMAKE_EXE%" --build "%BUILD_DIR%" --target pandoeditor --parallel 2
if errorlevel 1 goto build_failed
echo Built %APP_EXE%
if defined RUN_AFTER_BUILD goto run
exit /b 0

:build_failed
echo Local build failed.
goto error

:missing_qt
echo Qt was not found at "%QT_DIR%". Set PANDOEDITOR_QT_DIR.
goto error
:missing_mingw
echo MinGW was not found at "%MINGW_DIR%". Set PANDOEDITOR_MINGW_DIR.
goto error
:missing_exe
echo No local executable at "%APP_EXE%". Run "%~nx0 build" once.
goto error
:missing_cmake
echo CMake was not found. Set PANDOEDITOR_CMAKE_EXE.
goto error
:missing_ninja
echo Ninja was not found. Set PANDOEDITOR_NINJA_EXE.
goto error
:missing_zlib
echo MinGW zlib was not found at "%ZLIB_DIR%".
goto error

:error
if "%~1"=="" pause
exit /b 1
