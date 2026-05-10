import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, spring, Sequence, Audio, Img, staticFile, random } from 'remotion';

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

export const GeneratedComposition: React.FC = () => {
  return (
    <AbsoluteFill style={{ background: '#0f0a1e' }}>
      <Sequence from={0} durationInFrames={90}>
        <Scene1 />
      </Sequence>
      <Sequence from={90} durationInFrames={75}>
        <Scene2 />
      </Sequence>
      <Sequence from={165} durationInFrames={45}>
        <Scene3 />
      </Sequence>
    </AbsoluteFill>
  );
};

const Scene1: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const titleScale = spring({ frame, fps, config: { damping: 14, mass: 0.7 } });
  const titleOpacity = safeInterpolate(frame, [0, 12], [0, 1], { extrapolateRight: 'clamp' });
  const bgFrom = '#0f0a1e';
  const bgTo = '#4c1d95';
  return (
    <AbsoluteFill style={{ background: `linear-gradient(135deg, ${bgFrom}, ${bgTo})`, justifyContent: 'center', alignItems: 'center' }}>
      <div style={{ transform: `scale(${titleScale})`, opacity: titleOpacity, textAlign: 'center' }}>
        <h1 style={{ fontSize: 120, fontWeight: 800, color: '#fff', margin: 0, letterSpacing: '-0.02em', textShadow: '0 8px 32px rgba(0,0,0,0.3)' }}>Q4 战绩</h1>
      </div>
    </AbsoluteFill>
  );
};

const Scene2: React.FC = () => {
  const frame = useCurrentFrame();
  const accent = '#fbbf24';
  const titleOpacity = safeInterpolate(frame, [0, 16], [0, 1], { extrapolateRight: 'clamp' });
  const titleX = safeInterpolate(frame, [0, 20], [-30, 0], { extrapolateRight: 'clamp' });
  const items = ['用户增长 +120%', '上线 5 个核心功能', '团队扩到 12 人', '获 A 轮融资'];
  return (
    <AbsoluteFill style={{ background: '#0a0e1a', padding: '90px 110px', justifyContent: 'center' }}>
      <h2 style={{ color: '#fafafa', fontSize: 64, fontWeight: 700, marginBottom: 48, opacity: titleOpacity, transform: `translateX(${titleX}px)` }}></h2>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 22 }}>
        {items.map((item, i) => {
          const delay = 28 + i * 14;
          const op = safeInterpolate(frame, [delay, delay + 16], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
          const dx = safeInterpolate(frame, [delay, delay + 18], [40, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
          return (
            <li key={i} style={{ color: 'rgba(255,255,255,0.92)', fontSize: 36, opacity: op, transform: `translateX(${dx}px)`, display: 'flex', alignItems: 'center', gap: 18 }}>
              <span style={{ width: 14, height: 14, borderRadius: 999, background: accent, boxShadow: `0 0 16px ${accent}80`, flexShrink: 0 }} />
              {item}
            </li>
          );
        })}
      </ul>
    </AbsoluteFill>
  );
};

const Scene3: React.FC = () => {
  const frame = useCurrentFrame();
  const bgOpacity = safeInterpolate(frame, [0, 18], [0, 1], { extrapolateRight: 'clamp' });
  const taglineOpacity = safeInterpolate(frame, [12, 32], [0, 1], { extrapolateRight: 'clamp' });
  const taglineY = safeInterpolate(frame, [12, 32], [12, 0], { extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ background: '#000', opacity: bgOpacity }} />
      <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', flexDirection: 'column' }}>
        <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 22, opacity: taglineOpacity, transform: `translateY(${taglineY}px)`, letterSpacing: '0.12em', textTransform: 'uppercase' }}>To Be Continued</div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};