# Portable Package

这个项目已经准备成可搬运版本，适合拷贝到另一台 Windows 机器上恢复运行。

## 一键恢复

1. 解压整个压缩包到任意目录
2. 双击 `restore-and-run.cmd`
3. 脚本会自动执行：
   - 安装 Node.js LTS（如果本机还没有，可能会弹管理员确认）
   - 安装 npm 依赖
   - 安装 Remotion 渲染所需 Chromium
   - 启动本地服务
4. 打开浏览器访问 `http://localhost:3000`

## API Key

现在不需要提前写环境变量。

- Anthropic：在页面里选择 `Anthropic`，输入你的 key
- MiniMax：在页面里选择 `MiniMax`，输入你的 key

如果你仍然想用环境变量，也支持：

- `ANTHROPIC_API_KEY`
- `MINIMAX_API_KEY`

## 包内重要文件

- `restore-and-run.cmd`
  Windows 双击入口
- `scripts/restore-and-run.ps1`
  真正执行恢复和启动的脚本
- `build-portable-package.ps1`
  如果你想重新打包，可以在原项目里再次运行它

## 手动启动

如果已经恢复完成，之后也可以手动启动：

```powershell
node server.js
```

## 说明

- 首次启动下载 Chromium 会稍慢
- `node_modules` 没有打进压缩包，避免包太大；会在恢复时自动安装
- `renders/` 中现有的视频文件会一起打包，方便你把历史输出一并带走
