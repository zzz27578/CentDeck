@echo off
rem Copyright (c) 2026 zzz27578 and CentDeck contributors.
rem SPDX-License-Identifier: AGPL-3.0-only
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
    echo [CentDeck] 未找到 Node.js。
    echo 请先到 https://nodejs.org 下载安装 Node.js，然后重新双击本文件。
    pause
    exit /b 1
)
node server\server.js
echo.
echo CentDeck 已退出，按任意键关闭窗口。
pause >nul
