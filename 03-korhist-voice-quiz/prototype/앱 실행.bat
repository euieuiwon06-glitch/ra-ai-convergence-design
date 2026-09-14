@echo off
chcp 65001 >nul
title 한국사 암기 퀴즈 - 실행기
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 goto NOPYTHON

echo ============================================
echo   한국사 암기 퀴즈 프로토타입
echo ============================================
echo.
echo   서버를 시작하고 브라우저를 엽니다...
start "한국사암기 서버 (닫지 마세요)" python -m http.server 8123
timeout /t 1 >nul
start "" http://localhost:8123
echo.
echo   브라우저에 앱이 열렸습니다.
echo   서버는 '한국사암기 서버' 라는 창에서 실행 중입니다.
echo   다 쓰신 뒤 그 창을 닫으면 종료됩니다. (마이크 사용 가능)
echo.
timeout /t 5 >nul
exit /b

:NOPYTHON
echo ============================================
echo   Python이 설치되어 있지 않습니다.
echo ============================================
echo.
echo   파일 모드로 앱을 대신 엽니다.
echo   (이 경우 마이크가 막힐 수 있어요. 듣기 화면에서
echo    "키보드로 답하기"를 누르면 전체 흐름을 그대로 볼 수 있습니다.)
echo.
start "" "index.html"
timeout /t 5 >nul
exit /b
