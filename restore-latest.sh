#!/bin/bash
# 一键还原到最近一次 .backups/pre-*.tar.gz 备份
set -e

cd "$(dirname "$0")"

LATEST=$(ls -t .backups/pre-*.tar.gz 2>/dev/null | head -1)
if [ -z "$LATEST" ]; then
  echo "❌ .backups/ 下没有备份"
  exit 1
fi

echo "将从 $LATEST 还原"
echo "会覆盖：server.js / sql-store.js / pages / src / styles / scripts / data 等"
read -p "确认 [y/N]: " ans
if [ "$ans" != "y" ] && [ "$ans" != "Y" ]; then
  echo "已取消"
  exit 0
fi

tar -xzf "$LATEST"
echo "✅ 还原完成。如有需要请重启 server.js（kill 现有进程 + node server.js）"
