#!/usr/bin/env bash
# CentDeck 百映 · 本地服务启动脚本（等价于 CentDeck.bat）
set -e
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "[CentDeck] 未找到 Node.js。"
  echo "请先安装 Node.js（https://nodejs.org）后再运行本脚本。"
  exit 1
fi
exec node server/server.js
