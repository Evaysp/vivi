<<<<<<< HEAD
# vivi
video-ai-studio
=======
# 🎬 Remotion AI · 提示词生成视频

一个 AI 驱动的视频生成 Web 应用，输入提示词，自动生成精美的 Remotion 动画视频。

## 架构

```
用户提示词
    │
    ▼
Claude API (claude-opus-4-5)
生成 Remotion TSX 代码
    │
    ▼
写入 src/compositions/Generated.tsx
    │
    ▼
@remotion/bundler 打包
    │
    ▼
@remotion/renderer 渲染 MP4
    │
    ▼
浏览器播放 & 下载
```

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 设置环境变量

```bash
export ANTHROPIC_API_KEY=your_api_key_here
```

### 3. 安装 Chromium（Remotion 渲染需要）

```bash
npx remotion browser ensure
# 或者
npx @remotion/renderer install chrome
```

### 4. 启动服务器

```bash
node server.js
```

### 5. 访问应用

打开浏览器访问 http://localhost:3000

## 迁移到另一台机器

如果你想把当前项目打成一个可搬运包：

```powershell
powershell -ExecutionPolicy Bypass -File .\build-portable-package.ps1
```

执行后会在 `dist/` 下生成一个完整压缩包。

在新机器上：

1. 解压压缩包
2. 双击 `restore-and-run.cmd`
3. 等待脚本自动安装 Node.js、依赖和 Chromium
4. 打开 `http://localhost:3000`

说明：

- 页面里可以直接输入 Anthropic 或 MiniMax 的 API Key
- 如果机器上没有 Node.js，脚本会尝试用 `winget` 自动安装 LTS 版本
- 更详细的说明见 `PORTABLE-README.md`

## 使用方法

1. 在文本框中输入你想要的视频描述（中英文均可）
2. 点击「生成视频」或按 Enter
3. 等待 AI 生成代码（约 10-30 秒）
4. 等待 Remotion 渲染（约 30-120 秒，取决于机器性能）
5. 预览并下载生成的 MP4 视频

## 视频规格

- **分辨率**: 1280 × 720 (720p)
- **帧率**: 30 FPS
- **时长**: 5 秒 (150 帧)
- **编码**: H.264

## 提示词示例

- "科技感产品发布动画，展示「NEXUS 2.0」，带粒子特效"
- "流动的海浪背景，文字随波浪渐显"
- "抽象几何艺术，彩色图形碰撞旋转"
- "数据大屏，数字从0跳跃到100%的动画"
- "璀璨星空，粒子汇聚成文字"

## 技术栈

- **后端**: Node.js + Express
- **AI**: Anthropic Claude API (claude-opus-4-5)
- **视频**: Remotion 4.x (bundler + renderer)
- **前端**: 原生 HTML/CSS/JS

## 注意事项

- 首次运行需要下载 Chromium 浏览器内核（约 300MB）
- 渲染时 CPU 占用较高，建议在性能较好的机器上运行
- 每次生成的代码会覆盖 `src/compositions/Generated.tsx`
- 渲染的视频保存在 `renders/` 目录下
>>>>>>> 3d7b942 (Initial commit)
