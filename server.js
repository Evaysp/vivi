const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const {v4: uuidv4} = require('uuid');
const Anthropic = require('@anthropic-ai/sdk');
const esbuild = require('esbuild');
const next = require('next');
const {getPublicTemplateCatalog, resolveTemplateSelection, syncTemplateCatalogFromFile} = require('./template-catalog');
const {
  completeGenerationJob,
  createGenerationJob,
  ensureDatabase,
  failGenerationJob,
  getDatabaseSummary,
  getGenerationJob,
  getSkillBySlug,
  insertGenerationEvent,
  listGenerationJobs,
  listSkills,
  saveGenerationJobAgentPlan,
  saveGenerationJobCode,
  seedSkills,
  updateGenerationJobProgress,
} = require('./sql-store');
const {SEED_SKILLS} = require('./scripts/seed-skills');

const app = express();
const dev = process.env.NODE_ENV !== 'production';
const nextApp = next({dev, dir: __dirname});
const nextHandler = nextApp.getRequestHandler();

app.use(cors());
app.use(express.json());
app.use(express.static('public'));
app.use('/downloads', express.static('downloads'));
app.use('/renders', express.static('renders'));

const REQUIRED_REACT_IMPORT = "import React from 'react';";
const REQUIRED_REMOTION_IMPORT =
  "import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, spring, Sequence, Audio, Img, staticFile, random } from 'remotion';";
const SAFE_INTERPOLATE_HELPER = `
const __normalizeInputRange = (inputRange: number[]) => {
  if (!Array.isArray(inputRange) || inputRange.length <= 1) {
    return inputRange;
  }

  const normalized = [Number(inputRange[0])];

  for (let i = 1; i < inputRange.length; i++) {
    const rawValue = Number(inputRange[i]);
    const previous = normalized[i - 1];
    const nextValue = Number.isFinite(rawValue) && rawValue > previous ? rawValue : previous + 0.0001;
    normalized.push(nextValue);
  }

  return normalized;
};

const safeInterpolate = (input: number, inputRange: number[], outputRange: number[], options?: any) => {
  return interpolate(input, __normalizeInputRange(inputRange), outputRange, options);
};
`.trim();
const REMOTION_BUNDLE_DIR = path.join(__dirname, '.cache', 'remotion-bundle');

let pendingRenderJobs = 0;
let renderQueue = Promise.resolve();

const PROVIDERS = {
  anthropic: {
    label: 'Anthropic',
    baseURL: 'https://api.anthropic.com',
    defaultModel: 'claude-sonnet-4-6',
    envKey: 'ANTHROPIC_API_KEY',
  },
  minimax: {
    label: 'MiniMax',
    baseURL: 'https://api.minimaxi.com/anthropic',
    defaultModel: 'MiniMax-M2.7',
    envKey: 'MINIMAX_API_KEY',
  },
};

const TEMPLATE_AGENT_SYSTEM_PROMPT = `You are a template fusion planning agent for Remotion.
You receive up to 3 selected public template references plus a new user prompt.
Your job is to understand the user's intent, decide how the selected templates should be blended, and output a structured production plan.

STRICT OUTPUT RULES:
- Return JSON only. No markdown fences, no commentary.
- Use this exact top-level shape:
{
  "summary": "string",
  "blendMode": "string",
  "selectedTemplateRoles": [
    {
      "slug": "string",
      "title": "string",
      "role": "string",
      "mustKeep": ["string"],
      "adapt": ["string"]
    }
  ],
  "sequencePlan": [
    {
      "section": "opening|middle|closing",
      "frames": "string",
      "goal": "string",
      "animation": "string"
    }
  ],
  "visualDirection": {
    "palette": ["string"],
    "background": "string",
    "typography": "string",
    "motionStyle": "string"
  },
  "tsxBuildInstructions": ["string"],
  "riskChecks": ["string"]
}

RULES:
- Base the plan only on the provided public metadata: title, category, description, tags, and customization prompt.
- You do NOT have the original login-gated TSX source code. Do not pretend that you saw or copied it.
- The final result should be one coherent new Remotion video, not three disconnected clips.
- Be concrete about timing, hierarchy, text treatment, and motion language.
- Keep the plan concise but actionable.`;

const REMOTION_SYSTEM_PROMPT = `You are an expert Remotion video composition engineer and motion designer.
Your job is to convert a user's text prompt, selected template references, and an agent plan into a stunning, production-quality Remotion React component.

STRICT OUTPUT RULES:
- Output ONLY valid TypeScript/TSX code. No markdown fences, no explanations, no comments outside the code.
- The code must export a named export: export const GeneratedComposition: React.FC = () => { ... }
- The file MUST start with the exact imports below and nothing before them.
- Keep the implementation compact enough to finish in one response. Prefer reusable helpers and array maps over long repetitive JSX.

REQUIRED IMPORTS (copy exactly):
import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, spring, Sequence, Audio, Img, staticFile, random } from 'remotion';

CANVAS SIZE: 1280x720px, 30fps, ~210 frames (7 seconds). Design for this exact canvas.

REMOTION SAFETY RULES:
- If you use random(), the argument must be a number or a string seed.
- Valid examples: random(i), random('particle-1'), random(\`particle-\${i}\`)
- Never call random() with an object such as random({frame, seed}).
- inputRange passed to interpolate() must always be strictly increasing.
- If an end frame might equal the start frame, write Math.max(start + 1, end) before calling interpolate().

RENDER PERFORMANCE RULES:
- Keep the scene performant enough to render quickly on a normal desktop.
- Prefer 6-12 decorative shapes, not 50+ particles or dozens of expensive layers.
- Avoid SVG turbulence / fractal noise filters, full-screen base64 texture overlays, and heavy blur on large elements.
- Avoid huge box-shadow stacks, excessive mixBlendMode usage, and dense per-frame math inside large arrays.
- Favor clean gradients, a few accent elements, and strong typography over raw element count.

DESIGN PRINCIPLES - make every video stunning:
1. ALWAYS use rich, creative backgrounds: gradients, geometric patterns, particle systems, SVG art - never plain solid colors.
2. ALWAYS animate everything: entrance animations, continuous motion, exit animations. Use spring() for natural physics.
3. Typography: large, bold, cinematic text. Use Google Fonts via @import if helpful (add a <style> tag inside the component).
4. Color: use vibrant, harmonious color palettes. Pick a mood and commit to it.
5. Layering: use multiple AbsoluteFill layers for depth - background layer, content layer, overlay/vignette layer.
6. Timing: stagger animations across frames for a polished, professional feel.
7. Add decorative elements: circles, lines, blobs, geometric shapes as visual accents.

ANIMATION TECHNIQUES:
- spring({ frame, fps, config: { damping: 12 } }) for bouncy entrances
- interpolate(frame, [start, end], [from, to], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) for smooth transitions
- Use frame % period for looping animations
- Combine scale + opacity + translateY for dynamic entrances

TEMPLATE FUSION RULES:
- The selected templates are references derived from public showcase metadata only, not raw source code.
- Blend the selected template ideas into one original composition. Do not mention missing source access in the output.
- Respect the agent plan's sequence, but keep the implementation compact and renderable.
- If multiple templates are selected, synthesize their strongest motifs into one visual language instead of making a chaotic collage.

EXAMPLE STRUCTURE:
export const GeneratedComposition: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();

  const titleScale = spring({ frame, fps, config: { damping: 10 } });
  const titleOpacity = interpolate(frame, [0, 20], [0, 1], { extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ background: 'linear-gradient(...)' }} />
      <AbsoluteFill>{/* Decorative elements */}</AbsoluteFill>
      <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center' }}>
        <div style={{ transform: \`scale(\${titleScale})\`, opacity: titleOpacity }}>
          Main Content
        </div>
      </AbsoluteFill>
      <AbsoluteFill style={{ background: 'radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.4) 100%)' }} />
    </AbsoluteFill>
  );
};

Now create an extraordinary composition that satisfies the user's prompt and the agent plan. Be creative, bold, cinematic, and production-ready.`;

const VISUAL_PLANNER_SYSTEM_PROMPT = `你是 Remotion 动效视觉总监。你的工作是和用户对话，把 ta 想要的视频细化成清晰可执行的画面方案。**你不写代码。**

工作流程：
1. 第一次：用户给你一个想法（可能附带 0-3 个参考模板 + 一份 skill 库清单）。你判断要怎么实现，输出完整方案。
2. 后续：用户会针对方案给反馈。你根据反馈修订方案，再次输出完整的最新方案。
3. 反复迭代直到用户确认。

==== Skill 优先原则（重要） ====
项目内置了一组**预先验证、可直接拼装**的 skill。你应该**优先**用 skill 来构造每个 scene：
- 每个 scene 如果能映射到某个 skill，就把 scene.skillSlug 设为对应 slug，并填好 scene.props（必填字段不能漏，可选字段酌情）
- skill 的 frameRange 是建议时长，scene.frames 应大致接近（可按需要拉伸/压缩，但别差太远）
- 如果**任何 skill 都不合适**（比如用户要的是一个完全独特的画面），把 scene.skillSlug 留空字符串 ""，并用 elements + motion 自由描述（这会让代码 Agent 自由发挥，但稳定性下降）
- 不要硬塞 skill：宁可 skillSlug="" 自由描述，也别用错的 skill 凑数

==== 模板使用判断 ====
模板（template）是从公网抓的元数据，只是风格参考、不是代码：
- 用户描述具体 → 直接靠 skill 实现，可以不参考模板
- 用户希望某种风格质感 → 参考模板的 description / tags 来选 skill 或调 props（配色、节奏）

==== 输出格式 ====
每一次回复都必须是合法 JSON（不要 markdown，不要解释，纯 JSON）：

{
  "agentMessage": "用第二人称对用户说的话。介绍这次方案的关键决策、为什么选这些 skill、和上一版相比改了什么。简洁，2-4 句。",
  "plan": {
    "title": "短标题（10字内）",
    "summary": "一段话概括整体视觉感觉和叙事主线",
    "useTemplates": true 或 false,
    "templateNotes": "如果 useTemplates 为 true，说明每个模板被用作什么参考；为 false 则空字符串",
    "duration": "视频时长（如 7秒 / 210帧）",
    "canvas": "1280x720 30fps",
    "scenes": [
      {
        "name": "段落名（开场/主体/结尾 等）",
        "frames": "起止帧（如 0-60）",
        "narrative": "用户在这段画面里看到什么、感受到什么",
        "skillSlug": "对应的 skill slug 或 空字符串",
        "props": { "和 skill inputSchema 对齐的参数对象，留空则 {}" },
        "elements": ["仅在 skillSlug 为空时使用，描述自由场景的视觉元素"],
        "motion": "仅在 skillSlug 为空时使用，描述自由动效"
      }
    ],
    "visualStyle": {
      "palette": ["#xxxxxx", "#xxxxxx"],
      "background": "背景描述（渐变/网格/粒子/纯色 等）",
      "typography": "字体风格 + 字号大小关系",
      "motionStyle": "整体动效语言（克制/夸张/弹性/平滑）"
    }
  }
}

注意：
- 时长默认 7 秒（210 帧），除非用户另有要求
- 配色给具体十六进制；与所选 skill 的 props（如 paletteFrom / accentColor）保持一致
- agentMessage 用中文，简明扼要
- 同一个 skill 可以在不同 scene 重复使用
- props 字段名严格对照后续给你的 skill 清单，不要发明字段`;

const REMOTION_VISUAL_PLAN_SYSTEM_PROMPT = `You are an expert Remotion video composition engineer.
Your job is to convert a confirmed visual plan into a stunning, production-quality Remotion React component.

STRICT OUTPUT RULES:
- Output ONLY valid TypeScript/TSX code. No markdown fences, no explanations, no comments outside the code.
- The code must export: export const GeneratedComposition: React.FC = () => { ... }
- The file MUST start with the exact imports below and nothing before them.
- Keep the implementation compact enough to finish in one response.

REQUIRED IMPORTS (copy exactly):
import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, spring, Sequence, Audio, Img, staticFile, random } from 'remotion';

CANVAS SIZE: 1280x720px, 30fps, ~210 frames (7 seconds). Design for this exact canvas.

REMOTION SAFETY RULES:
- If you use random(), the argument must be a number or a string seed.
- Valid examples: random(i), random('particle-1'), random(\`particle-\${i}\`)
- Never call random() with an object such as random({frame, seed}).
- inputRange passed to interpolate() must always be strictly increasing.
- If an end frame might equal the start frame, write Math.max(start + 1, end) before calling interpolate().

RENDER PERFORMANCE RULES:
- Keep the scene performant enough to render quickly on a normal desktop.
- Prefer 6-12 decorative shapes, not 50+ particles or dozens of expensive layers.
- Avoid SVG turbulence / fractal noise filters, full-screen base64 texture overlays, and heavy blur on large elements.
- Avoid huge box-shadow stacks, excessive mixBlendMode usage, and dense per-frame math inside large arrays.

PLAN FIDELITY RULES (CRITICAL):
- The user has already confirmed the visual plan. Implement it FAITHFULLY.
- Respect each scene's frames range, narrative, and (when present) skillSlug + props.
- Use the palette colors from visualStyle.palette as the primary palette.
- Do not invent new scenes or remove planned scenes. Do not change scene order.
- If template references are listed, use them only as stylistic reference, not as code copy targets.
- Wording: keep any specific text strings the user mentioned; otherwise pick concise text consistent with the narrative.

SKILL FIDELITY RULES (CRITICAL):
- The user message includes a "Skill reference" section listing each skill's input schema and a JSX code template (an IIFE that returns JSX).
- For every scene whose skillSlug matches a listed skill, you MUST adapt that skill's code template:
  1. Take the IIFE body as your scene's JSX
  2. Wrap it in <Sequence from={sceneStartFrame} durationInFrames={sceneLength}>...</Sequence>
  3. Inside the Sequence, the skill expects \`frame\` to be the sequence-local frame. Compute it as: const sceneFrame = useCurrentFrame() - sceneStartFrame; — OR rely on Sequence's own currentFrame scope by calling useCurrentFrame() inside an inner sub-component.
  4. Define a const props object literal with the scene's props, then reference it inside the JSX exactly as the template does
  5. Do NOT alter the visual structure of the skill template. You may only adapt: prop values, sequence positioning, and minor color tweaks to align with visualStyle.palette.
- For scenes with empty skillSlug (or whose skillSlug is not in the reference), write JSX yourself based on the scene's narrative, elements, and motion fields — keep it consistent with visualStyle.
- The composition should sequence scenes back-to-back according to plan.scenes ordering and their frames ranges.
- Place all scene Sequences inside the AbsoluteFill returned by GeneratedComposition.

ANIMATION TECHNIQUES:
- spring({ frame, fps, config: { damping: 12 } }) for bouncy entrances
- interpolate(frame, [start, end], [from, to], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) for smooth transitions
- Use Sequence to scope each scene to its frame range
- Combine scale + opacity + translateY for dynamic entrances

Output the TSX only.`;

const REMOTION_REPAIR_PROMPT = `You repair malformed Remotion React TSX files.

STRICT OUTPUT RULES:
- Output ONLY the full corrected TypeScript/TSX file.
- No markdown fences, no explanations, no commentary.
- Preserve the user's intended visual concept, but prioritize valid code over exact wording.
- The file must export: export const GeneratedComposition: React.FC = () => { ... }
- The file must start with these exact imports and nothing before them:

import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, spring, Sequence, Audio, Img, staticFile, random } from 'remotion';

REPAIR GOALS:
- Fix any syntax errors, truncation, unclosed JSX, broken template strings, and mismatched brackets.
- Fix invalid interpolate() ranges so every inputRange is strictly increasing.
- If any copied text is garbled or unsafe to preserve, replace it with simple clean text.
- Return a complete, self-contained file that can be parsed as TSX.
- Keep the code concise enough to fit in one complete response.`;

const planSessions = new Map();
const PLAN_SESSION_TTL_MS = 60 * 60 * 1000;

function pruneExpiredPlanSessions() {
  const now = Date.now();
  for (const [id, session] of planSessions) {
    if (now - session.lastActiveAt > PLAN_SESSION_TTL_MS) {
      planSessions.delete(id);
    }
  }
}

const planSessionSweeper = setInterval(pruneExpiredPlanSessions, 5 * 60 * 1000);
if (typeof planSessionSweeper.unref === 'function') {
  planSessionSweeper.unref();
}

function getProviderConfig(providerId) {
  return PROVIDERS[providerId] || PROVIDERS.anthropic;
}

function resolveApiKey(providerId, apiKey) {
  if (apiKey && apiKey.trim()) {
    return apiKey.trim();
  }

  const provider = getProviderConfig(providerId);
  return process.env[provider.envKey] || null;
}

function createAnthropicClient(providerId, apiKey, options = {}) {
  const provider = getProviderConfig(providerId);
  const resolvedApiKey = resolveApiKey(providerId, apiKey);

  if (!resolvedApiKey) {
    throw new Error(`Missing API key for ${provider.label}. Enter one in the page or set ${provider.envKey}.`);
  }

  const clientOptions = {
    apiKey: resolvedApiKey,
    baseURL: provider.baseURL,
  };

  if (options.useDirectFetch) {
    clientOptions.fetch = globalThis.fetch.bind(globalThis);
  }

  return new Anthropic.default(clientOptions);
}

function resolveModelId(providerId, model) {
  const provider = getProviderConfig(providerId);
  return model && model.trim() ? model.trim() : provider.defaultModel;
}

function isConnectionLikeError(error) {
  if (!error) {
    return false;
  }

  if (error.constructor?.name === 'APIConnectionError' || error.constructor?.name === 'APIConnectionTimeoutError') {
    return true;
  }

  const message = typeof error.message === 'string' ? error.message : '';
  return /connection error|timed out|econnreset|enotfound|econnrefused|socket hang up/i.test(message);
}

function getProxyEnvironmentHints() {
  const proxyKeys = ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy'];

  return proxyKeys
    .map((key) => ({key, value: process.env[key]}))
    .filter((entry) => typeof entry.value === 'string' && entry.value.trim());
}

function hasLocalProxyConfiguration() {
  return getProxyEnvironmentHints().some((entry) => /127\.0\.0\.1|localhost/.test(entry.value));
}

function formatConnectionErrorMessage(error) {
  const causeCode = error?.cause?.code ? String(error.cause.code) : '';
  const causeMessage = typeof error?.cause?.message === 'string' ? error.cause.message.trim() : '';
  const proxyHints = getProxyEnvironmentHints();
  const proxySummary = proxyHints.length
    ? ` Detected proxy env: ${proxyHints.map((entry) => `${entry.key}=${entry.value}`).join(', ')}.`
    : '';

  const localProxyHint = hasLocalProxyConfiguration()
    ? ' A local proxy is configured. Make sure it is running, or clear the proxy environment variables and restart the server.'
    : '';

  if (causeCode || causeMessage) {
    const detail = [causeCode, causeMessage].filter(Boolean).join(' - ');
    return `Model API connection failed: ${detail}.${proxySummary}${localProxyHint}`.trim();
  }

  return `Model API connection failed.${proxySummary}${localProxyHint}`.trim();
}

function tryExtractTextFromMessage(message) {
  const blocks = Array.isArray(message?.content) ? message.content : [];
  return blocks
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n\n')
    .trim();
}

function buildEmptyResponseError(message) {
  const blocks = Array.isArray(message?.content) ? message.content : [];
  const blockTypes = blocks.map((b) => b?.type).filter(Boolean).join(', ') || 'none';
  const stopReason = message?.stop_reason || 'unknown';
  const usage = message?.usage
    ? `, tokens=in:${message.usage.input_tokens || 0}/out:${message.usage.output_tokens || 0}`
    : '';
  const hint = stopReason === 'max_tokens'
    ? '（输出被 max_tokens 截断了，请稍后重试或简化方案）'
    : stopReason === 'refusal'
      ? '（模型拒绝了该请求，请调整提示词）'
      : '（请稍后重试，或检查 API 额度/网络）';
  return new Error(
    `模型返回了空响应 stop_reason=${stopReason}, blocks=[${blockTypes}]${usage} ${hint}`,
  );
}

function extractTextFromMessage(message) {
  const text = tryExtractTextFromMessage(message);
  if (!text) {
    throw buildEmptyResponseError(message);
  }
  return text;
}

function formatErrorMessage(error) {
  const firstEsbuildError = error?.errors?.[0];
  if (firstEsbuildError?.text) {
    const location = firstEsbuildError.location
      ? `${path.basename(firstEsbuildError.location.file)}:${firstEsbuildError.location.line}:${firstEsbuildError.location.column}`
      : null;

    return location ? `${location}: ${firstEsbuildError.text}` : firstEsbuildError.text;
  }

  if (isConnectionLikeError(error)) {
    return formatConnectionErrorMessage(error);
  }

  if (error?.error?.message) {
    return error.error.message;
  }

  if (typeof error?.message === 'string' && error.message.trim()) {
    return error.message.trim().split('\n')[0];
  }

  return 'Unknown error';
}

function extractJsonObject(text) {
  const normalized = normalizeGeneratedCode(text);

  try {
    return JSON.parse(normalized);
  } catch (_error) {
    const firstBrace = normalized.indexOf('{');
    const lastBrace = normalized.lastIndexOf('}');

    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
      throw new Error('Agent response did not contain a JSON object.');
    }

    return JSON.parse(normalized.slice(firstBrace, lastBrace + 1));
  }
}

function buildFallbackAgentPlan(prompt, selectedTemplates) {
  const openingFrames = selectedTemplates.length > 1 ? '0-70' : '0-60';
  const middleFrames = selectedTemplates.length > 2 ? '70-150' : '60-150';

  return {
    summary: `Blend ${selectedTemplates.map((template) => template.title).join(' + ')} into one customized composition for: ${prompt}`,
    blendMode: 'template-informed original composition',
    selectedTemplateRoles: selectedTemplates.map((template, index) => ({
      slug: template.slug,
      title: template.title,
      role: index === 0 ? 'primary visual anchor' : index === selectedTemplates.length - 1 ? 'final accent layer' : 'supporting motif',
      mustKeep: [template.description],
      adapt: [template.prompt ? template.prompt.split('\n').filter(Boolean)[0] : 'Adapt typography, color, and timing to the user prompt.'],
    })),
    sequencePlan: [
      {
        section: 'opening',
        frames: openingFrames,
        goal: 'Introduce the main theme with the strongest chosen template motif.',
        animation: 'Use a confident entrance with bold typography, layered background motion, and one signature accent effect.',
      },
      {
        section: 'middle',
        frames: middleFrames,
        goal: 'Blend supporting template ideas into the core composition without breaking visual consistency.',
        animation: 'Stagger secondary elements, deepen motion, and reinforce the message hierarchy.',
      },
      {
        section: 'closing',
        frames: '150-210',
        goal: 'Deliver a memorable final lockup and clean ending pose.',
        animation: 'Settle to a strong hero frame with a graceful outro or glow-down.',
      },
    ],
    visualDirection: {
      palette: ['#0f172a', '#38bdf8', '#f8fafc', '#22c55e'],
      background: 'Layered gradients with depth accents and subtle geometric or light-based motion.',
      typography: 'Large cinematic headline with one secondary line and high contrast hierarchy.',
      motionStyle: 'Polished, modern, precise, and suitable for a short branded motion piece.',
    },
    tsxBuildInstructions: [
      'Create one coherent composition instead of separate mini-scenes.',
      'Use the selected templates only as stylistic references and synthesize a fresh implementation.',
      'Keep the code compact, performant, and safe for Remotion rendering.',
      'Ensure the user prompt has clear influence over wording, palette, and motion emphasis.',
    ],
    riskChecks: [
      'Do not rely on unavailable template source code.',
      'Keep interpolate input ranges strictly increasing.',
      'Avoid too many particles or expensive full-screen effects.',
    ],
  };
}

function buildRandomSeedExpression(seedExpr, frameExpr, index) {
  const seed = seedExpr ? seedExpr.trim() : null;
  const frame = frameExpr ? frameExpr.trim() : null;

  if (seed && frame) {
    return `random(String(${seed}) + "-" + String(${frame}))`;
  }

  if (seed) {
    return `random(String(${seed}))`;
  }

  if (frame) {
    return `random(String(${frame}) + "-fallback-${index}")`;
  }

  return `random('fallback-seed-${index}')`;
}

function sanitizeGeneratedCode(code) {
  let replacementCount = 0;

  const sanitized = code.replace(/random\(\s*\{([\s\S]*?)\}\s*\)/g, (_match, objectBody) => {
    replacementCount += 1;

    const frameMatch = objectBody.match(/frame\s*:\s*([^,}]+)/);
    const seedMatch = objectBody.match(/seed\s*:\s*([^,}]+)/);

    return buildRandomSeedExpression(
      seedMatch ? seedMatch[1] : null,
      frameMatch ? frameMatch[1] : null,
      replacementCount,
    );
  });

  return {code: sanitized, replacementCount};
}

function normalizeGeneratedCode(code) {
  return code
    .replace(/^```[\w]*\n?/gm, '')
    .replace(/^```\s*$/gm, '')
    .replace(/\uFEFF/g, '')
    .trim();
}

function ensureRequiredImports(code) {
  const withoutCoreImports = code
    .replace(/^\s*import\s+[\s\S]*?\s+from\s+['"]react['"]\s*;?\s*/gm, '')
    .replace(/^\s*import\s+[\s\S]*?\s+from\s+['"]remotion['"]\s*;?\s*/gm, '')
    .trimStart();

  return `${REQUIRED_REACT_IMPORT}\n${REQUIRED_REMOTION_IMPORT}\n\n${withoutCoreImports}`.trim();
}

function injectRuntimeGuards(code) {
  if (code.includes('const safeInterpolate = (')) {
    return code;
  }

  const rewritten = code.replace(/\binterpolate\(/g, 'safeInterpolate(');
  const lines = rewritten.split(/\r?\n/);
  let insertIndex = 0;

  while (insertIndex < lines.length) {
    const line = lines[insertIndex].trim();
    if (!line || line.startsWith('import ')) {
      insertIndex += 1;
      continue;
    }

    break;
  }

  const importBlock = lines.slice(0, insertIndex).join('\n').trimEnd();
  const body = lines.slice(insertIndex).join('\n').trimStart();

  return `${importBlock}\n\n${SAFE_INTERPOLATE_HELPER}\n\n${body}`.trim();
}

function finalizeGeneratedCode(code) {
  const normalized = normalizeGeneratedCode(code);
  const {code: sanitizedCode, replacementCount} = sanitizeGeneratedCode(normalized);
  const withImports = ensureRequiredImports(sanitizedCode);

  return {
    code: injectRuntimeGuards(withImports),
    replacementCount,
  };
}

function queueRender(task) {
  const queuedAhead = pendingRenderJobs;
  pendingRenderJobs += 1;

  const run = renderQueue.catch(() => undefined).then(task);
  renderQueue = run.catch(() => undefined);

  return {
    queuedAhead,
    promise: run.finally(() => {
      pendingRenderJobs = Math.max(0, pendingRenderJobs - 1);
    }),
  };
}

function mapStepToJobStatus(step) {
  switch (step) {
    case 1:
      return 'loading_templates';
    case 2:
      return 'planning';
    case 3:
      return 'generating_code';
    case 4:
      return 'bundling';
    case 5:
      return 'rendering';
    default:
      return 'running';
  }
}

function getEventProgress(event, data = {}) {
  if (typeof data.progress === 'number') {
    return data.progress;
  }

  switch (event) {
    case 'agent':
      return 38;
    case 'code':
      return 58;
    case 'complete':
      return 100;
    default:
      return 0;
  }
}

function buildEventPayload(event, data = {}) {
  switch (event) {
    case 'status':
      return typeof data.renderProgress === 'number' ? {renderProgress: data.renderProgress} : null;
    case 'agent':
      return {
        selectedTemplates: data.selectedTemplates || [],
        plan: data.plan || null,
      };
    case 'code':
      return {
        codeLength: typeof data.code === 'string' ? data.code.length : 0,
      };
    case 'complete':
      return {
        videoUrl: data.videoUrl || '',
      };
    default:
      return null;
  }
}

function persistGenerationEvent(jobId, event, data = {}) {
  const step = typeof data.step === 'number' ? data.step : 0;
  const progress = getEventProgress(event, data);
  const message = data.message || null;

  insertGenerationEvent({
    jobId,
    eventType: event,
    step,
    progress,
    message,
    payload: buildEventPayload(event, data),
  });

  switch (event) {
    case 'status':
      updateGenerationJobProgress({
        jobId,
        status: mapStepToJobStatus(step),
        step,
        progress,
        statusText: message,
      });
      break;
    case 'agent':
      saveGenerationJobAgentPlan(jobId, data.plan || null);
      updateGenerationJobProgress({
        jobId,
        status: mapStepToJobStatus(step),
        step,
        progress,
        statusText: message || 'Template fusion plan ready.',
      });
      break;
    case 'code':
      saveGenerationJobCode(jobId, data.code || '');
      updateGenerationJobProgress({
        jobId,
        status: mapStepToJobStatus(step),
        step,
        progress,
        statusText: message || 'TSX generated.',
      });
      break;
    case 'complete':
      completeGenerationJob(jobId, {
        step,
        progress,
        statusText: message || 'Video render complete.',
        videoUrl: data.videoUrl || '',
        renderOutputPath: data.renderOutputPath || '',
      });
      break;
    case 'error':
      failGenerationJob(jobId, {
        step,
        progress,
        statusText: message || 'Job failed.',
        errorMessage: message || 'Unknown error',
      });
      break;
    default:
      break;
  }
}

function safePersistGenerationEvent(jobId, event, data = {}) {
  try {
    persistGenerationEvent(jobId, event, data);
  } catch (error) {
    console.error(`Failed to persist ${event} event for job ${jobId}:`, error);
  }
}

function parseLimit(value, fallback = 20, max = 100) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.min(parsed, max);
}

async function requestModelText({
  client,
  fallbackClient = null,
  providerLabel = 'Model provider',
  resolvedModel,
  system,
  userContent,
  maxTokens = 7000,
}) {
  return requestChatCompletion({
    client,
    fallbackClient,
    providerLabel,
    resolvedModel,
    system,
    messages: [{role: 'user', content: userContent}],
    maxTokens,
  });
}

async function requestChatCompletion({
  client,
  fallbackClient = null,
  providerLabel = 'Model provider',
  resolvedModel,
  system,
  messages,
  maxTokens = 4000,
}) {
  const requestPayload = {
    model: resolvedModel,
    max_tokens: maxTokens,
    system,
    messages,
  };

  const callOnce = async (chosenClient) => {
    const message = await chosenClient.messages.create(requestPayload);
    return {message, text: tryExtractTextFromMessage(message)};
  };

  let firstResult;
  try {
    firstResult = await callOnce(client);
  } catch (error) {
    if (fallbackClient && isConnectionLikeError(error)) {
      console.warn(
        `${providerLabel} chat request failed with a connection error. Retrying once with direct fetch fallback...`,
        error?.cause?.message || error?.message || error,
      );

      const fallbackResult = await callOnce(fallbackClient);
      if (!fallbackResult.text) {
        throw buildEmptyResponseError(fallbackResult.message);
      }
      return normalizeGeneratedCode(fallbackResult.text);
    }

    throw error;
  }

  if (firstResult.text) {
    return normalizeGeneratedCode(firstResult.text);
  }

  console.warn(
    `${providerLabel} returned an empty response (stop_reason=${firstResult.message?.stop_reason}, blocks=[${(firstResult.message?.content || []).map((b) => b?.type).join(',')}]). Retrying once...`,
  );

  if (fallbackClient) {
    try {
      const retryResult = await callOnce(fallbackClient);
      if (retryResult.text) {
        return normalizeGeneratedCode(retryResult.text);
      }
      console.warn(
        `${providerLabel} retry also returned an empty response (stop_reason=${retryResult.message?.stop_reason}).`,
      );
    } catch (retryError) {
      console.warn(`${providerLabel} retry failed:`, retryError?.message || retryError);
    }
  }

  throw buildEmptyResponseError(firstResult.message);
}

function buildTemplateReferencePayload(selectedTemplates) {
  return selectedTemplates.map((template) => ({
    slug: template.slug,
    title: template.title,
    category: template.category,
    description: template.description,
    tags: template.tags,
    fileName: template.fileName,
    prompt: template.prompt,
  }));
}

async function createTemplateAgentPlan({client, fallbackClient, providerLabel, resolvedModel, prompt, selectedTemplates}) {
  const fallbackPlan = buildFallbackAgentPlan(prompt, selectedTemplates);

  try {
    const planText = await requestModelText({
      client,
      fallbackClient,
      providerLabel,
      resolvedModel,
      system: TEMPLATE_AGENT_SYSTEM_PROMPT,
      userContent: `User prompt:
${prompt}

Selected template references:
${JSON.stringify(buildTemplateReferencePayload(selectedTemplates), null, 2)}

Return the planning JSON only.`,
      maxTokens: 2200,
    });

    const parsedPlan = extractJsonObject(planText);

    return {
      ...fallbackPlan,
      ...parsedPlan,
      selectedTemplateRoles: Array.isArray(parsedPlan.selectedTemplateRoles) && parsedPlan.selectedTemplateRoles.length > 0
        ? parsedPlan.selectedTemplateRoles
        : fallbackPlan.selectedTemplateRoles,
      sequencePlan: Array.isArray(parsedPlan.sequencePlan) && parsedPlan.sequencePlan.length > 0
        ? parsedPlan.sequencePlan
        : fallbackPlan.sequencePlan,
      visualDirection: {
        ...fallbackPlan.visualDirection,
        ...(parsedPlan.visualDirection || {}),
      },
      tsxBuildInstructions: Array.isArray(parsedPlan.tsxBuildInstructions) && parsedPlan.tsxBuildInstructions.length > 0
        ? parsedPlan.tsxBuildInstructions
        : fallbackPlan.tsxBuildInstructions,
      riskChecks: Array.isArray(parsedPlan.riskChecks) && parsedPlan.riskChecks.length > 0
        ? parsedPlan.riskChecks
        : fallbackPlan.riskChecks,
    };
  } catch (error) {
    console.warn('Template agent planning failed, using fallback plan:', formatErrorMessage(error));
    return fallbackPlan;
  }
}

function buildSkillCatalogSummary(skills) {
  if (!Array.isArray(skills) || skills.length === 0) {
    return 'Skill 库为空。所有 scene 都需要 skillSlug="" 自由描述。';
  }

  const lines = skills.map((skill) => {
    const schema = skill.inputSchema || {};
    const fieldDescs = Object.entries(schema).map(([name, spec]) => {
      const required = spec && spec.required ? '*' : '';
      const type = (spec && spec.type) || 'any';
      const desc = (spec && spec.description) || '';
      return `${name}${required}:${type}${desc ? ` (${desc})` : ''}`;
    });
    const props = fieldDescs.length ? fieldDescs.join('; ') : '无 props';
    const example = skill.exampleProps ? ` 示例 props=${JSON.stringify(skill.exampleProps)}` : '';
    return `- ${skill.slug} (${skill.category || '其他'}, ~${skill.frameRange}帧): ${skill.intent || skill.name}\n    props: ${props}${example}`;
  });

  return `可用 skill 清单（带 * 为必填字段；scene 选这些 skill 拼装时严格按字段名给 props）：
${lines.join('\n')}`;
}

function buildPlannerInitialUserMessage(prompt, selectedTemplates, skills) {
  const templatePart = selectedTemplates.length
    ? `用户挑了 ${selectedTemplates.length} 个参考模板（仅供你参考，是否使用由你判断）：
${JSON.stringify(buildTemplateReferencePayload(selectedTemplates), null, 2)}`
    : '用户没有挑选参考模板。如果你认为完全可以原创，就把 useTemplates 设为 false。';

  const skillPart = buildSkillCatalogSummary(skills);

  return `用户的视频想法：
${prompt}

${templatePart}

${skillPart}

请输出第一版完整方案 JSON。优先用 skill 拼装；任何 scene 用不上 skill 时把 skillSlug 设为 ""。`;
}

async function runVisualPlanner({
  client,
  fallbackClient,
  providerLabel,
  resolvedModel,
  messages,
}) {
  const text = await requestChatCompletion({
    client,
    fallbackClient,
    providerLabel,
    resolvedModel,
    system: VISUAL_PLANNER_SYSTEM_PROMPT,
    messages,
    maxTokens: 3200,
  });

  const parsed = extractJsonObject(text);
  const plan = parsed && typeof parsed.plan === 'object' && parsed.plan ? parsed.plan : null;
  const agentMessage = typeof parsed?.agentMessage === 'string' ? parsed.agentMessage.trim() : '';

  if (!plan) {
    throw new Error('Planner agent did not return a plan object.');
  }

  return {
    agentMessage: agentMessage || '已更新方案，请查看右侧细节。',
    plan,
    rawAssistantText: text,
  };
}

function buildSkillReferenceSection(skillReferenceBundle) {
  if (!Array.isArray(skillReferenceBundle) || skillReferenceBundle.length === 0) {
    return '(plan does not reference any skill — implement scenes from scratch following the plan)';
  }

  return skillReferenceBundle
    .map((skill) => {
      const schemaLines = Object.entries(skill.inputSchema || {}).map(([name, spec]) => {
        const required = spec && spec.required ? '*' : '';
        const type = (spec && spec.type) || 'any';
        const desc = (spec && spec.description) || '';
        return `    - ${name}${required}: ${type}${desc ? ` (${desc})` : ''}`;
      });
      const schemaBlock = schemaLines.length ? schemaLines.join('\n') : '    (no props)';
      return `### Skill: ${skill.slug} (${skill.category || 'misc'}, ~${skill.frameRange} frames)
Intent: ${skill.intent || ''}
Motion style: ${skill.motionStyle || ''}
Input schema:
${schemaBlock}

Code template (reference IIFE returning JSX. Globals available inside: \`frame\` (local to Sequence), \`fps\`, \`durationInFrames\`, \`props\`):
\`\`\`tsx
${skill.codeTemplate}
\`\`\``;
    })
    .join('\n\n---\n\n');
}

async function generateRemotionCodeFromVisualPlan({
  prompt,
  client,
  fallbackClient,
  providerLabel,
  resolvedModel,
  selectedTemplates,
  visualPlan,
  skillReferenceBundle = [],
}) {
  console.log(
    `Generating Remotion code from confirmed visual plan with ${providerLabel} (${resolvedModel}).`,
  );

  const skillSection = buildSkillReferenceSection(skillReferenceBundle);

  const userContent = `Build a Remotion composition that faithfully implements this confirmed visual plan.

Original user prompt:
${prompt}

Template references (use only as stylistic reference, not as source code):
${
    selectedTemplates.length
      ? JSON.stringify(buildTemplateReferencePayload(selectedTemplates), null, 2)
      : '(none — pure original composition)'
  }

Confirmed visual plan:
${JSON.stringify(visualPlan, null, 2)}

Skill reference (for any scene whose skillSlug matches one below, lift the code template, adapt props from the scene, wrap it in a <Sequence from={start} durationInFrames={length}>; for scenes with empty skillSlug, write the JSX yourself per the plan's narrative/elements/motion):
${skillSection}

Output the TSX only, starting with the required imports.`;

  const code = await requestChatCompletion({
    client,
    fallbackClient,
    providerLabel,
    resolvedModel,
    system: REMOTION_VISUAL_PLAN_SYSTEM_PROMPT,
    messages: [{role: 'user', content: userContent}],
    maxTokens: 12000,
  });

  const {code: sanitizedCode, replacementCount} = finalizeGeneratedCode(code);
  if (replacementCount > 0) {
    console.log(`Sanitized ${replacementCount} invalid random() call(s) from generated code.`);
  }

  const validation = await validateGeneratedCode(sanitizedCode);
  if (validation.valid) {
    return sanitizedCode;
  }

  console.warn('Generated code failed validation, attempting automatic repair:', validation.error);

  const repairedCode = await repairRemotionCode({
    client,
    fallbackClient,
    providerLabel,
    resolvedModel,
    prompt,
    code: sanitizedCode,
    validationError: validation.error,
  });

  const repairedValidation = await validateGeneratedCode(repairedCode);
  if (!repairedValidation.valid) {
    throw new Error(`Generated Remotion code is invalid after automatic repair: ${repairedValidation.error}`);
  }

  console.log('Generated code repaired successfully after validation failure.');
  return repairedCode;
}

async function validateGeneratedCode(code) {
  try {
    await esbuild.transform(code, {
      loader: 'tsx',
      format: 'esm',
      target: 'es2020',
    });

    return {valid: true, error: null};
  } catch (error) {
    return {
      valid: false,
      error: formatErrorMessage(error),
    };
  }
}

async function repairRemotionCode({client, fallbackClient, providerLabel, resolvedModel, prompt, code, validationError}) {
  const repaired = await requestModelText({
    client,
    fallbackClient,
    providerLabel,
    resolvedModel,
    system: REMOTION_REPAIR_PROMPT,
    userContent: `The following Remotion composition is invalid and must be repaired.

Original user prompt:
${prompt}

Validation error:
${validationError}

Broken TSX:
${code}

Return the full corrected TSX file only.`,
  });

  const {code: sanitizedCode, replacementCount} = finalizeGeneratedCode(repaired);
  if (replacementCount > 0) {
    console.log(`Sanitized ${replacementCount} invalid random() call(s) from repaired code.`);
  }

  return sanitizedCode;
}

async function generateRemotionCode({
  prompt,
  providerId,
  client,
  fallbackClient,
  providerLabel,
  resolvedModel,
  selectedTemplates,
  agentPlan,
}) {
  const provider = getProviderConfig(providerId);

  console.log(
    `Generating Remotion code with ${provider.label} (${resolvedModel}) for prompt "${prompt}" using ${selectedTemplates.length} template(s).`,
  );

  const code = await requestModelText({
    client,
    fallbackClient,
    providerLabel,
    resolvedModel,
    system: REMOTION_SYSTEM_PROMPT,
    userContent: `Create a stunning Remotion video composition from this brief.

User prompt:
${prompt}

Selected template references:
${JSON.stringify(buildTemplateReferencePayload(selectedTemplates), null, 2)}

Template fusion agent plan:
${JSON.stringify(agentPlan, null, 2)}

Important:
- These templates are references only, derived from public showcase metadata.
- Build one original TSX composition that blends the selected references according to the user request.
- Output ONLY the TSX code, starting with the imports. No markdown, no explanation.`,
  });

  const {code: sanitizedCode, replacementCount} = finalizeGeneratedCode(code);
  if (replacementCount > 0) {
    console.log(`Sanitized ${replacementCount} invalid random() call(s) from generated code.`);
  }

  const validation = await validateGeneratedCode(sanitizedCode);
  if (validation.valid) {
    return sanitizedCode;
  }

  console.warn('Generated code failed validation, attempting automatic repair:', validation.error);

  const repairedCode = await repairRemotionCode({
    client,
    fallbackClient,
    providerLabel,
    resolvedModel,
    prompt,
    code: sanitizedCode,
    validationError: validation.error,
  });

  const repairedValidation = await validateGeneratedCode(repairedCode);
  if (!repairedValidation.valid) {
    throw new Error(`Generated Remotion code is invalid after automatic repair: ${repairedValidation.error}`);
  }

  console.log('Generated code repaired successfully after validation failure.');
  return repairedCode;
}

async function renderVideo(compositionCode, jobId, options = {}) {
  const {bundle} = require('@remotion/bundler');
  const {renderMedia, selectComposition} = require('@remotion/renderer');
  const onRenderProgress = typeof options.onRenderProgress === 'function' ? options.onRenderProgress : null;

  const compositionPath = path.join(__dirname, 'src/compositions/Generated.tsx');
  fs.writeFileSync(compositionPath, compositionCode, 'utf-8');
  console.log('Composition written to', compositionPath);

  const bundleStart = Date.now();
  console.log('Bundling...');
  const bundled = await bundle({
    entryPoint: path.join(__dirname, 'src/index.tsx'),
    webpackOverride: (config) => config,
    outDir: REMOTION_BUNDLE_DIR,
    enableCaching: true,
  });
  console.log(`Bundle ready in ${Date.now() - bundleStart}ms`);

  const composition = await selectComposition({
    serveUrl: bundled,
    id: 'GeneratedVideo',
    inputProps: {},
  });

  const outputPath = path.join(__dirname, 'renders', `${jobId}.mp4`);
  const renderStart = Date.now();
  let lastReportedProgress = -1;
  console.log('Rendering video...');

  await renderMedia({
    composition,
    serveUrl: bundled,
    codec: 'h264',
    outputLocation: outputPath,
    inputProps: {},
    onProgress: ({progress}) => {
      const percent = Math.round(progress * 100);
      process.stdout.write(`\r   Progress: ${percent}%`);

      if (onRenderProgress && (percent === 100 || percent - lastReportedProgress >= 5)) {
        lastReportedProgress = percent;
        onRenderProgress(percent);
      }
    },
  });

  console.log(`\nVideo rendered in ${Date.now() - renderStart}ms:`, outputPath);
  return outputPath;
}

function resolveModelClients(provider, apiKey, model) {
  const providerConfig = getProviderConfig(provider);
  const client = createAnthropicClient(provider, apiKey);
  const fallbackClient = createAnthropicClient(provider, apiKey, {useDirectFetch: true});
  const resolvedModel = resolveModelId(provider, model);
  return {providerConfig, client, fallbackClient, resolvedModel};
}

function resolveSelectionOrThrow(slugs) {
  if (!Array.isArray(slugs)) {
    throw new Error('selectedTemplateSlugs must be an array');
  }

  const selection = resolveTemplateSelection(slugs);

  if (selection.uniqueSlugs.length > 3) {
    throw new Error('You can select at most 3 templates');
  }

  if (selection.missingSlugs.length > 0) {
    throw new Error(`Unknown template slug(s): ${selection.missingSlugs.join(', ')}`);
  }

  return selection;
}

app.post('/api/plan/start', async (req, res) => {
  try {
    const {prompt, provider = 'anthropic', apiKey = '', model = '', selectedTemplateSlugs = []} = req.body || {};

    if (!prompt || !String(prompt).trim()) {
      return res.status(400).json({error: 'Prompt is required'});
    }

    if (!PROVIDERS[provider]) {
      return res.status(400).json({error: `Unsupported provider: ${provider}`});
    }

    let selection;
    try {
      selection = resolveSelectionOrThrow(selectedTemplateSlugs);
    } catch (selectionError) {
      return res.status(400).json({error: formatErrorMessage(selectionError)});
    }

    let modelClients;
    try {
      modelClients = resolveModelClients(provider, apiKey, model);
    } catch (clientError) {
      return res.status(400).json({error: formatErrorMessage(clientError)});
    }

    const trimmedPrompt = String(prompt).trim();
    const availableSkills = listSkills({enabledOnly: true});
    const initialUserMessage = buildPlannerInitialUserMessage(trimmedPrompt, selection.selectedTemplates, availableSkills);

    const messages = [{role: 'user', content: initialUserMessage}];

    const {agentMessage, plan, rawAssistantText} = await runVisualPlanner({
      client: modelClients.client,
      fallbackClient: modelClients.fallbackClient,
      providerLabel: modelClients.providerConfig.label,
      resolvedModel: modelClients.resolvedModel,
      messages,
    });

    messages.push({role: 'assistant', content: rawAssistantText});

    const sessionId = uuidv4();
    const now = Date.now();

    planSessions.set(sessionId, {
      id: sessionId,
      createdAt: now,
      lastActiveAt: now,
      prompt: trimmedPrompt,
      provider,
      apiKey,
      model,
      selectedTemplateSlugs: selection.uniqueSlugs,
      selectedTemplates: selection.selectedTemplates,
      messages,
      latestPlan: plan,
      consumed: false,
    });

    return res.json({
      sessionId,
      agentMessage,
      plan,
      provider,
      providerLabel: modelClients.providerConfig.label,
      model: modelClients.resolvedModel,
      selectedTemplates: buildTemplateReferencePayload(selection.selectedTemplates).map((t) => ({
        slug: t.slug,
        title: t.title,
        category: t.category,
      })),
    });
  } catch (error) {
    console.error('plan/start error:', error);
    return res.status(500).json({error: formatErrorMessage(error)});
  }
});

app.post('/api/plan/feedback', async (req, res) => {
  try {
    const {sessionId, feedback} = req.body || {};

    if (!sessionId || typeof sessionId !== 'string') {
      return res.status(400).json({error: 'sessionId is required'});
    }

    if (!feedback || !String(feedback).trim()) {
      return res.status(400).json({error: 'feedback is required'});
    }

    const session = planSessions.get(sessionId);
    if (!session) {
      return res.status(404).json({error: '会话已过期或不存在，请回首页重新开始。'});
    }

    if (session.consumed) {
      return res.status(409).json({error: '该方案已确认进入渲染，无法再修改。'});
    }

    let modelClients;
    try {
      modelClients = resolveModelClients(session.provider, session.apiKey, session.model);
    } catch (clientError) {
      return res.status(400).json({error: formatErrorMessage(clientError)});
    }

    session.messages.push({role: 'user', content: String(feedback).trim()});

    const {agentMessage, plan, rawAssistantText} = await runVisualPlanner({
      client: modelClients.client,
      fallbackClient: modelClients.fallbackClient,
      providerLabel: modelClients.providerConfig.label,
      resolvedModel: modelClients.resolvedModel,
      messages: session.messages,
    });

    session.messages.push({role: 'assistant', content: rawAssistantText});
    session.latestPlan = plan;
    session.lastActiveAt = Date.now();

    return res.json({
      sessionId,
      agentMessage,
      plan,
    });
  } catch (error) {
    console.error('plan/feedback error:', error);
    return res.status(500).json({error: formatErrorMessage(error)});
  }
});

app.post('/api/plan/render', async (req, res) => {
  const {sessionId} = req.body || {};

  if (!sessionId || typeof sessionId !== 'string') {
    return res.status(400).json({error: 'sessionId is required'});
  }

  const session = planSessions.get(sessionId);
  if (!session) {
    return res.status(404).json({error: '会话已过期或不存在，请回首页重新开始。'});
  }

  if (!session.latestPlan) {
    return res.status(400).json({error: '当前会话还没有方案，无法渲染。'});
  }

  if (session.consumed) {
    return res.status(409).json({error: '该方案已经确认渲染过一次。'});
  }

  let modelClients;
  try {
    modelClients = resolveModelClients(session.provider, session.apiKey, session.model);
  } catch (clientError) {
    return res.status(400).json({error: formatErrorMessage(clientError)});
  }

  session.consumed = true;
  session.lastActiveAt = Date.now();

  const jobId = uuidv4();
  const selectedTemplatePayload = buildTemplateReferencePayload(session.selectedTemplates);

  try {
    createGenerationJob({
      jobId,
      prompt: session.prompt,
      provider: session.provider,
      providerLabel: modelClients.providerConfig.label,
      model: modelClients.resolvedModel,
      selectedTemplateSlugs: session.selectedTemplateSlugs,
      selectedTemplates: selectedTemplatePayload,
    });
  } catch (error) {
    return res.status(500).json({error: formatErrorMessage(error)});
  }

  let heartbeat = null;
  let streamClosed = false;

  try {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    res.socket?.setKeepAlive?.(true, 1000);

    const markClosed = () => {
      streamClosed = true;
      if (heartbeat) {
        clearInterval(heartbeat);
        heartbeat = null;
      }
    };

    req.on('aborted', markClosed);
    res.on('close', markClosed);

    const writeChunk = (chunk) => {
      if (streamClosed || res.writableEnded || res.destroyed) {
        return false;
      }

      try {
        res.write(chunk);
        return true;
      } catch (_writeError) {
        markClosed();
        return false;
      }
    };

    const sendEvent = (event, data) => {
      safePersistGenerationEvent(jobId, event, data);
      return writeChunk(`data: ${JSON.stringify({event, ...data})}\n\n`);
    };

    heartbeat = setInterval(() => {
      writeChunk(`: keepalive ${Date.now()}\n\n`);
    }, 10000);

    sendEvent('agent', {
      plan: session.latestPlan,
      selectedTemplates: selectedTemplatePayload.map((t) => ({
        slug: t.slug,
        title: t.title,
        category: t.category,
      })),
      message: '方案已确认，开始生成 TSX...',
      step: 2,
    });

    sendEvent('status', {
      message: 'Agent is generating a renderable TSX composition...',
      step: 3,
      progress: 50,
    });

    const referencedSkillSlugs = Array.from(
      new Set(
        ((session.latestPlan && session.latestPlan.scenes) || [])
          .map((s) => (s && typeof s.skillSlug === 'string' ? s.skillSlug.trim() : ''))
          .filter(Boolean),
      ),
    );

    const skillReferenceBundle = referencedSkillSlugs
      .map((slug) => getSkillBySlug(slug))
      .filter(Boolean);

    if (skillReferenceBundle.length > 0) {
      console.log(
        `Plan references ${skillReferenceBundle.length} skill(s): ${skillReferenceBundle.map((s) => s.slug).join(', ')}`,
      );
    }

    const code = await generateRemotionCodeFromVisualPlan({
      prompt: session.prompt,
      client: modelClients.client,
      fallbackClient: modelClients.fallbackClient,
      providerLabel: modelClients.providerConfig.label,
      resolvedModel: modelClients.resolvedModel,
      selectedTemplates: session.selectedTemplates,
      visualPlan: session.latestPlan,
      skillReferenceBundle,
    });

    sendEvent('code', {
      code,
      message: 'TSX generated. Preparing the Remotion render pipeline...',
      step: 3,
    });
    sendEvent('status', {
      message: 'Bundling the Remotion project...',
      step: 4,
      progress: 72,
    });

    const {queuedAhead, promise} = queueRender(() =>
      renderVideo(code, jobId, {
        onRenderProgress: (percent) => {
          const uiProgress = Math.min(99, 72 + Math.round(percent * 0.27));
          sendEvent('status', {
            message: percent >= 100 ? 'Finalizing video...' : `Rendering video... ${percent}%`,
            step: 5,
            progress: uiProgress,
            renderProgress: percent,
          });
        },
      }),
    );

    if (queuedAhead > 0) {
      sendEvent('status', {
        message: `A render is already running. Waiting for ${queuedAhead} job(s) ahead before starting yours...`,
        step: 4,
        progress: 68,
      });
    }

    const renderOutputPath = await promise;

    sendEvent('complete', {
      videoUrl: `/renders/${jobId}.mp4`,
      renderOutputPath,
      message: 'Video render complete.',
      step: 5,
    });

    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
    res.end();
  } catch (error) {
    const message = formatErrorMessage(error);
    console.error('plan/render error:', error);
    safePersistGenerationEvent(jobId, 'error', {
      message,
      step: 0,
      progress: 0,
    });

    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }

    try {
      if (!streamClosed && !res.writableEnded && !res.destroyed) {
        res.write(`data: ${JSON.stringify({event: 'error', message})}\n\n`);
        res.end();
      }
    } catch (_streamError) {
      // Connection already closed.
    }
  }
});

app.get('/api/templates', (_req, res) => {
  try {
    res.json(getPublicTemplateCatalog());
  } catch (error) {
    res.status(500).json({error: formatErrorMessage(error)});
  }
});

app.get('/api/skills', (req, res) => {
  try {
    const includeDisabled = req.query.includeDisabled === '1' || req.query.includeDisabled === 'true';
    const category = typeof req.query.category === 'string' && req.query.category.trim() ? req.query.category.trim() : null;
    const skills = listSkills({enabledOnly: !includeDisabled, category});
    const categories = Array.from(new Set(skills.map((s) => s.category).filter(Boolean)));
    res.json({skills, categories, total: skills.length});
  } catch (error) {
    res.status(500).json({error: formatErrorMessage(error)});
  }
});

app.get('/api/skills/:slug', (req, res) => {
  try {
    const skill = getSkillBySlug(req.params.slug);
    if (!skill) {
      return res.status(404).json({error: 'Skill not found'});
    }
    res.json(skill);
  } catch (error) {
    res.status(500).json({error: formatErrorMessage(error)});
  }
});

app.post('/api/generate', async (req, res) => {
  const {prompt, provider = 'anthropic', apiKey = '', model = '', selectedTemplateSlugs = []} = req.body;

  if (!prompt || !prompt.trim()) {
    return res.status(400).json({error: 'Prompt is required'});
  }

  if (!PROVIDERS[provider]) {
    return res.status(400).json({error: `Unsupported provider: ${provider}`});
  }

  if (!Array.isArray(selectedTemplateSlugs)) {
    return res.status(400).json({error: 'selectedTemplateSlugs must be an array'});
  }

  let selection;

  try {
    selection = resolveTemplateSelection(selectedTemplateSlugs);
  } catch (error) {
    return res.status(500).json({error: formatErrorMessage(error)});
  }
  if (selection.uniqueSlugs.length === 0) {
    return res.status(400).json({error: 'Select at least 1 template'});
  }

  if (selection.uniqueSlugs.length > 3) {
    return res.status(400).json({error: 'You can select at most 3 templates'});
  }

  if (selection.missingSlugs.length > 0) {
    return res.status(400).json({error: `Unknown template slug(s): ${selection.missingSlugs.join(', ')}`});
  }

  const providerConfig = getProviderConfig(provider);
  let client;
  let fallbackClient = null;
  let resolvedModel;

  try {
    client = createAnthropicClient(provider, apiKey);
    fallbackClient = createAnthropicClient(provider, apiKey, {useDirectFetch: true});
    resolvedModel = resolveModelId(provider, model);
  } catch (error) {
    return res.status(400).json({error: formatErrorMessage(error)});
  }

  const jobId = uuidv4();
  const selectedTemplatePayload = buildTemplateReferencePayload(selection.selectedTemplates);
  console.log(`\nJob ${jobId} started with templates: ${selection.selectedTemplates.map((template) => template.slug).join(', ')}`);

  try {
    createGenerationJob({
      jobId,
      prompt: prompt.trim(),
      provider,
      providerLabel: providerConfig.label,
      model: resolvedModel,
      selectedTemplateSlugs: selection.uniqueSlugs,
      selectedTemplates: selectedTemplatePayload,
    });
  } catch (error) {
    return res.status(500).json({error: formatErrorMessage(error)});
  }

  let heartbeat = null;
  let streamClosed = false;

  try {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    res.socket?.setKeepAlive?.(true, 1000);

    const markClosed = () => {
      streamClosed = true;
      if (heartbeat) {
        clearInterval(heartbeat);
        heartbeat = null;
      }
    };

    req.on('aborted', markClosed);
    res.on('close', markClosed);

    const writeChunk = (chunk) => {
      if (streamClosed || res.writableEnded || res.destroyed) {
        return false;
      }

      try {
        res.write(chunk);
        return true;
      } catch (_writeError) {
        markClosed();
        return false;
      }
    };

    const sendEvent = (event, data) => {
      safePersistGenerationEvent(jobId, event, data);
      return writeChunk(`data: ${JSON.stringify({event, ...data})}\n\n`);
    };

    heartbeat = setInterval(() => {
      writeChunk(`: keepalive ${Date.now()}\n\n`);
    }, 10000);

    sendEvent('status', {
      message: `Loading ${selection.selectedTemplates.length} selected template reference(s)...`,
      step: 1,
      progress: 12,
    });

    sendEvent('status', {
      message: `Template agent is analyzing your prompt with ${providerConfig.label} (${resolvedModel})...`,
      step: 2,
      progress: 26,
    });

    const agentPlan = await createTemplateAgentPlan({
      client,
      fallbackClient,
      providerLabel: providerConfig.label,
      resolvedModel,
      prompt,
      selectedTemplates: selection.selectedTemplates,
    });

    sendEvent('agent', {
      plan: agentPlan,
      selectedTemplates: selectedTemplatePayload.map((template) => ({
        slug: template.slug,
        title: template.title,
        category: template.category,
      })),
      message: 'Template fusion plan ready.',
      step: 2,
    });

    sendEvent('status', {
      message: 'Agent is generating a renderable TSX composition...',
      step: 3,
      progress: 50,
    });

    const code = await generateRemotionCode({
      prompt,
      providerId: provider,
      client,
      fallbackClient,
      providerLabel: providerConfig.label,
      resolvedModel,
      selectedTemplates: selection.selectedTemplates,
      agentPlan,
    });

    sendEvent('code', {
      code,
      message: 'TSX generated. Preparing the Remotion render pipeline...',
      step: 3,
    });
    sendEvent('status', {
      message: 'Bundling the Remotion project...',
      step: 4,
      progress: 72,
    });

    const {queuedAhead, promise} = queueRender(() =>
      renderVideo(code, jobId, {
        onRenderProgress: (percent) => {
          const uiProgress = Math.min(99, 72 + Math.round(percent * 0.27));
          sendEvent('status', {
            message: percent >= 100 ? 'Finalizing video...' : `Rendering video... ${percent}%`,
            step: 5,
            progress: uiProgress,
            renderProgress: percent,
          });
        },
      }),
    );

    if (queuedAhead > 0) {
      sendEvent('status', {
        message: `A render is already running. Waiting for ${queuedAhead} job(s) ahead before starting yours...`,
        step: 4,
        progress: 68,
      });
    }

    const renderOutputPath = await promise;

    sendEvent('complete', {
      videoUrl: `/renders/${jobId}.mp4`,
      renderOutputPath,
      message: 'Video render complete.',
      step: 5,
    });

    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
    res.end();
  } catch (error) {
    const message = formatErrorMessage(error);
    console.error('Error:', error);
    safePersistGenerationEvent(jobId, 'error', {
      message,
      step: 0,
      progress: 0,
    });

    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }

    try {
      if (!streamClosed && !res.writableEnded && !res.destroyed) {
        res.write(`data: ${JSON.stringify({event: 'error', message})}\n\n`);
        res.end();
      }
    } catch (_streamError) {
      // Connection already closed.
    }
  }
});

app.get('/api/jobs', (req, res) => {
  try {
    const limit = parseLimit(req.query.limit, 20, 100);
    res.json({
      jobs: listGenerationJobs(limit),
      database: getDatabaseSummary(),
    });
  } catch (error) {
    res.status(500).json({error: formatErrorMessage(error)});
  }
});

app.get('/api/jobs/:jobId', (req, res) => {
  try {
    const job = getGenerationJob(req.params.jobId);
    if (!job) {
      return res.status(404).json({error: 'Job not found'});
    }

    res.json(job);
  } catch (error) {
    res.status(500).json({error: formatErrorMessage(error)});
  }
});

app.get('/api/code', (_req, res) => {
  const compositionPath = path.join(__dirname, 'src/compositions/Generated.tsx');
  if (fs.existsSync(compositionPath)) {
    res.json({code: fs.readFileSync(compositionPath, 'utf-8')});
    return;
  }

  res.json({code: ''});
});

app.get('/api/health', (_req, res) => {
  try {
    const catalog = getPublicTemplateCatalog();
    res.json({
      status: 'ok',
      time: new Date().toISOString(),
      providers: Object.keys(PROVIDERS),
      templates: catalog.templateCount,
      categories: catalog.categories,
      database: getDatabaseSummary(),
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      time: new Date().toISOString(),
      providers: Object.keys(PROVIDERS),
      database: (() => {
        try {
          return getDatabaseSummary();
        } catch {
          return null;
        }
      })(),
      error: formatErrorMessage(error),
    });
  }
});

async function startServer() {
  ensureDatabase();

  try {
    syncTemplateCatalogFromFile();
  } catch (error) {
    console.warn('Template catalog sync skipped:', formatErrorMessage(error));
  }

  try {
    const seeded = seedSkills(SEED_SKILLS);
    console.log(`Seeded ${seeded} skill(s) into DB.`);
  } catch (error) {
    console.warn('Skill seeding skipped:', formatErrorMessage(error));
  }

  await nextApp.prepare();

  app.all('*', (req, res) => {
    return nextHandler(req, res);
  });

  const PORT = process.env.PORT || 3000;
  const server = app.listen(PORT, () => {
    const databaseSummary = getDatabaseSummary();
    console.log(`\nRemotion AI Video Generator`);
    console.log(`   Server running at http://localhost:${PORT}`);
    console.log(`   Frontend: Next.js (${dev ? 'development' : 'production'} mode)`);
    console.log(`   Renders directory: ${path.join(__dirname, 'renders')}`);
    console.log(`   Database: ${databaseSummary.path}`);
    console.log(`   Templates in SQL: ${databaseSummary.templateCount}`);
    console.log(`   Providers: ${Object.values(PROVIDERS).map((provider) => provider.label).join(', ')}\n`);
  });

  server.timeout = 0;
  server.requestTimeout = 0;
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;
}

startServer().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
