#!/bin/bash
# start.sh - 一键启动脚本

echo "🎬 Remotion AI Video Generator"
echo "================================"

# Check API key
if [ -z "$ANTHROPIC_API_KEY" ]; then
  echo "❌ 错误: 未设置 ANTHROPIC_API_KEY"
  echo "   请运行: export ANTHROPIC_API_KEY=your_key_here"
  exit 1
fi

echo "✅ Anthropic API Key 已配置"

# Ensure renders directory exists
mkdir -p renders

# Check/install Chromium for Remotion
echo "🔍 检查 Chromium 浏览器..."
if ! npx remotion browser ensure --quiet 2>/dev/null; then
  echo "📥 安装 Chromium（首次运行需要）..."
  npx remotion browser ensure
fi

echo "✅ Chromium 就绪"
echo ""
echo "🚀 启动服务器..."
echo "   访问 http://localhost:3000"
echo ""

node server.js
