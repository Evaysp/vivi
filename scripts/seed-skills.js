/**
 * Seed skills: 通用动效积木的种子数据
 *
 * 每个 skill 是一段 JSX 片段（codeTemplate），约定如下运行时变量可用：
 *   - frame:  Sequence 内本地帧号（由 useCurrentFrame() 在 Sequence 内得到）
 *   - fps:    从 useVideoConfig() 得到
 *   - width / height
 *   - props:  用户传入的参数对象
 *   - durationInFrames: 该 Sequence 的总帧数
 *
 * Phase 2 的组装器会把 codeTemplate 包进 <Sequence from=.. durationInFrames=..>
 * 并在外层注入 const frame = useCurrentFrame() - sceneStart 等局部变量。
 */

const SEED_SKILLS = [
  {
    slug: 'gradient-title',
    name: '渐变标题',
    category: 'text',
    intent: '主标题以 spring 缩放进入，背景为对角线渐变色块',
    motionStyle: 'spring entrance + steady hold',
    frameRange: 90,
    inputSchema: {
      title: {type: 'string', required: true, description: '主标题文本'},
      subtitle: {type: 'string', required: false, description: '副标题（可选）'},
      paletteFrom: {type: 'string', required: false, description: '渐变起始色（hex）'},
      paletteTo: {type: 'string', required: false, description: '渐变结束色（hex）'},
    },
    defaults: {
      paletteFrom: '#0f172a',
      paletteTo: '#38bdf8',
    },
    exampleProps: {
      title: 'VELOX',
      subtitle: '极速启动',
      paletteFrom: '#1e1b4b',
      paletteTo: '#a78bfa',
    },
    tags: ['title', 'gradient', 'text'],
    codeTemplate: `(() => {
  const titleScale = spring({frame, fps, config: {damping: 14, mass: 0.7}});
  const titleOpacity = interpolate(frame, [0, 12], [0, 1], {extrapolateRight: 'clamp'});
  const subOpacity = interpolate(frame, [18, 30], [0, 1], {extrapolateRight: 'clamp'});
  const subY = interpolate(frame, [18, 36], [16, 0], {extrapolateRight: 'clamp'});
  const bgFrom = props.paletteFrom || '#0f172a';
  const bgTo = props.paletteTo || '#38bdf8';
  return (
    <AbsoluteFill style={{background: \`linear-gradient(135deg, \${bgFrom}, \${bgTo})\`, justifyContent: 'center', alignItems: 'center'}}>
      <div style={{transform: \`scale(\${titleScale})\`, opacity: titleOpacity, textAlign: 'center'}}>
        <h1 style={{fontSize: 120, fontWeight: 800, color: '#fff', margin: 0, letterSpacing: '-0.02em', textShadow: '0 8px 32px rgba(0,0,0,0.3)'}}>{props.title}</h1>
        {props.subtitle ? (
          <p style={{fontSize: 32, color: 'rgba(255,255,255,0.85)', marginTop: 18, opacity: subOpacity, transform: \`translateY(\${subY}px)\`}}>{props.subtitle}</p>
        ) : null}
      </div>
    </AbsoluteFill>
  );
})()`,
  },

  {
    slug: 'stat-counter',
    name: '数字滚动',
    category: 'data',
    intent: '一个大数字从起始值滚动到目标值，下方一行说明文字',
    motionStyle: 'eased number ramp',
    frameRange: 90,
    inputSchema: {
      label: {type: 'string', required: true, description: '说明文字（如 "用户数"）'},
      fromValue: {type: 'number', required: false, description: '起始值'},
      toValue: {type: 'number', required: true, description: '目标值'},
      unit: {type: 'string', required: false, description: '单位（如 "+" / "%"）'},
      accentColor: {type: 'string', required: false, description: '强调色 hex'},
    },
    defaults: {
      fromValue: 0,
      unit: '',
      accentColor: '#22c55e',
    },
    exampleProps: {
      label: '日活用户',
      fromValue: 0,
      toValue: 12500,
      unit: '+',
      accentColor: '#22c55e',
    },
    tags: ['data', 'number', 'counter'],
    codeTemplate: `(() => {
  const from = Number(props.fromValue ?? 0);
  const to = Number(props.toValue ?? 0);
  const accent = props.accentColor || '#22c55e';
  const value = interpolate(frame, [10, Math.max(11, durationInFrames - 20)], [from, to], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const labelOpacity = interpolate(frame, [0, 14], [0, 1], {extrapolateRight: 'clamp'});
  const numberScale = spring({frame: Math.max(0, frame - 6), fps, config: {damping: 16}});
  const display = Math.round(value).toLocaleString('en-US');
  return (
    <AbsoluteFill style={{background: '#0a0a0a', justifyContent: 'center', alignItems: 'center', flexDirection: 'column'}}>
      <div style={{transform: \`scale(\${numberScale})\`, color: accent, fontSize: 180, fontWeight: 800, lineHeight: 1, letterSpacing: '-0.04em', fontVariantNumeric: 'tabular-nums'}}>
        {display}{props.unit || ''}
      </div>
      <div style={{marginTop: 24, color: 'rgba(255,255,255,0.7)', fontSize: 28, opacity: labelOpacity, letterSpacing: '0.04em', textTransform: 'uppercase'}}>{props.label}</div>
    </AbsoluteFill>
  );
})()`,
  },

  {
    slug: 'quote-card',
    name: '引言卡片',
    category: 'text',
    intent: '一句引言渐入展示，下方署名，整体克制干净',
    motionStyle: 'gentle fade + slide up',
    frameRange: 105,
    inputSchema: {
      quote: {type: 'string', required: true, description: '引言主体'},
      author: {type: 'string', required: false, description: '署名'},
      bg: {type: 'string', required: false, description: '背景色 hex'},
    },
    defaults: {
      bg: '#111827',
    },
    exampleProps: {
      quote: '简单的事情重复做，重复的事情用心做。',
      author: '——某种共识',
      bg: '#0f172a',
    },
    tags: ['text', 'quote', 'minimal'],
    codeTemplate: `(() => {
  const bg = props.bg || '#111827';
  const quoteOpacity = interpolate(frame, [4, 24], [0, 1], {extrapolateRight: 'clamp'});
  const quoteY = interpolate(frame, [4, 24], [12, 0], {extrapolateRight: 'clamp'});
  const lineWidth = interpolate(frame, [10, 30], [0, 60], {extrapolateRight: 'clamp'});
  const authorOpacity = interpolate(frame, [30, 50], [0, 1], {extrapolateRight: 'clamp'});
  return (
    <AbsoluteFill style={{background: bg, justifyContent: 'center', alignItems: 'center', padding: 96}}>
      <div style={{width: lineWidth, height: 3, background: 'rgba(255,255,255,0.6)', borderRadius: 2, marginBottom: 36}} />
      <div style={{maxWidth: 900, opacity: quoteOpacity, transform: \`translateY(\${quoteY}px)\`}}>
        <p style={{color: '#fafafa', fontSize: 56, lineHeight: 1.35, fontWeight: 500, margin: 0, textAlign: 'center'}}>"{props.quote}"</p>
      </div>
      {props.author ? (
        <div style={{marginTop: 36, color: 'rgba(255,255,255,0.55)', fontSize: 24, opacity: authorOpacity, letterSpacing: '0.06em'}}>{props.author}</div>
      ) : null}
    </AbsoluteFill>
  );
})()`,
  },

  {
    slug: 'bullet-list',
    name: '列表错峰',
    category: 'text',
    intent: '一个标题 + 3-5 个项目逐条错峰滑入',
    motionStyle: 'staggered slide-in',
    frameRange: 150,
    inputSchema: {
      title: {type: 'string', required: true, description: '列表标题'},
      items: {type: 'array', required: true, description: '项目数组，3-5 条最佳'},
      accentColor: {type: 'string', required: false, description: '前置点色 hex'},
    },
    defaults: {
      accentColor: '#f59e0b',
    },
    exampleProps: {
      title: '本季要点',
      items: ['用户增长 +120%', '上线 5 个核心功能', '团队扩到 12 人', '获 A 轮融资'],
      accentColor: '#fbbf24',
    },
    tags: ['list', 'text', 'staggered'],
    codeTemplate: `(() => {
  const accent = props.accentColor || '#f59e0b';
  const titleOpacity = interpolate(frame, [0, 16], [0, 1], {extrapolateRight: 'clamp'});
  const titleX = interpolate(frame, [0, 20], [-30, 0], {extrapolateRight: 'clamp'});
  const items = Array.isArray(props.items) ? props.items.slice(0, 6) : [];
  return (
    <AbsoluteFill style={{background: '#0a0e1a', padding: '90px 110px', justifyContent: 'center'}}>
      <h2 style={{color: '#fafafa', fontSize: 64, fontWeight: 700, marginBottom: 48, opacity: titleOpacity, transform: \`translateX(\${titleX}px)\`}}>{props.title}</h2>
      <ul style={{listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 22}}>
        {items.map((item, i) => {
          const delay = 28 + i * 14;
          const op = interpolate(frame, [delay, delay + 16], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
          const dx = interpolate(frame, [delay, delay + 18], [40, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
          return (
            <li key={i} style={{color: 'rgba(255,255,255,0.92)', fontSize: 36, opacity: op, transform: \`translateX(\${dx}px)\`, display: 'flex', alignItems: 'center', gap: 18}}>
              <span style={{width: 14, height: 14, borderRadius: 999, background: accent, boxShadow: \`0 0 16px \${accent}80\`, flexShrink: 0}} />
              {item}
            </li>
          );
        })}
      </ul>
    </AbsoluteFill>
  );
})()`,
  },

  {
    slug: 'fade-outro',
    name: '渐隐收尾',
    category: 'transition',
    intent: '画面整体淡入黑底，可选展示品牌名/标语',
    motionStyle: 'fade-to-black ending',
    frameRange: 60,
    inputSchema: {
      brand: {type: 'string', required: false, description: '品牌名/标语（可选）'},
      tagline: {type: 'string', required: false, description: '副标语'},
    },
    defaults: {},
    exampleProps: {
      brand: 'VELOX',
      tagline: 'Move Faster',
    },
    tags: ['outro', 'fade', 'transition'],
    codeTemplate: `(() => {
  const bgOpacity = interpolate(frame, [0, 18], [0, 1], {extrapolateRight: 'clamp'});
  const brandOpacity = interpolate(frame, [12, 32], [0, 1], {extrapolateRight: 'clamp'});
  const brandY = interpolate(frame, [12, 32], [12, 0], {extrapolateRight: 'clamp'});
  const taglineOpacity = interpolate(frame, [26, 44], [0, 1], {extrapolateRight: 'clamp'});
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{background: '#000', opacity: bgOpacity}} />
      <AbsoluteFill style={{justifyContent: 'center', alignItems: 'center', flexDirection: 'column'}}>
        {props.brand ? (
          <div style={{color: '#fff', fontSize: 80, fontWeight: 700, opacity: brandOpacity, transform: \`translateY(\${brandY}px)\`, letterSpacing: '-0.02em'}}>{props.brand}</div>
        ) : null}
        {props.tagline ? (
          <div style={{color: 'rgba(255,255,255,0.5)', fontSize: 22, marginTop: 16, opacity: taglineOpacity, letterSpacing: '0.12em', textTransform: 'uppercase'}}>{props.tagline}</div>
        ) : null}
      </AbsoluteFill>
    </AbsoluteFill>
  );
})()`,
  },
];

module.exports = {SEED_SKILLS};
