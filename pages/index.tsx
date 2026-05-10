import Head from 'next/head';
import {useEffect, useMemo, useRef, useState} from 'react';
import styles from '../styles/Home.module.css';

type ProviderId = 'anthropic' | 'minimax';
type Step = 0 | 1 | 2 | 3 | 4 | 5;
type Phase = 'home' | 'planning' | 'rendering' | 'done';

type ProviderConfig = {
  label: string;
  defaultModel: string;
  providerHint: string;
  keyHint: string;
  modelHint: string;
  keyPlaceholder: string;
};

type TemplateReference = {
  slug: string;
  title: string;
  description: string;
  date: string;
  tags: string[];
  fileName: string;
  category: string;
  prompt: string;
  featured: boolean;
  templateUrl: string;
  codeStatus: string;
  previewVideoUrl: string;
  thumbnailUrl: string;
};

type SceneItem = {
  name?: string;
  frames?: string;
  narrative?: string;
  skillSlug?: string;
  props?: Record<string, unknown>;
  elements?: string[];
  motion?: string;
};

type VisualStyle = {
  palette?: string[];
  background?: string;
  typography?: string;
  motionStyle?: string;
};

type VisualPlan = {
  title?: string;
  summary?: string;
  useTemplates?: boolean;
  templateNotes?: string;
  duration?: string;
  canvas?: string;
  scenes?: SceneItem[];
  visualStyle?: VisualStyle;
};

type ChatMessage =
  | {id: string; role: 'user'; content: string}
  | {id: string; role: 'assistant'; content: string; plan: VisualPlan | null};

type TemplateCatalogResponse = {
  templates?: TemplateReference[];
  categories?: string[];
  error?: string;
};

type PlanResponse = {
  sessionId: string;
  agentMessage: string;
  plan: VisualPlan;
  selectedTemplates?: Array<{slug: string; title: string; category: string}>;
};

type StreamEvent =
  | {
      event: 'status';
      message?: string;
      step?: Step;
      progress?: number;
      renderProgress?: number;
    }
  | {
      event: 'agent';
      plan?: VisualPlan;
      selectedTemplates?: Array<{slug: string; title: string; category: string}>;
      message?: string;
      step?: Step;
    }
  | {
      event: 'code';
      code?: string;
      message?: string;
      step?: Step;
    }
  | {
      event: 'complete';
      videoUrl: string;
      message?: string;
      step?: Step;
    }
  | {
      event: 'error';
      message?: string;
    };

const PROVIDERS: Record<ProviderId, ProviderConfig> = {
  anthropic: {
    label: 'Anthropic',
    defaultModel: 'claude-sonnet-4-6',
    providerHint: '使用 Anthropic Messages API 作为视觉规划 Agent 与 TSX 生成模型。',
    keyHint: '如果留空，后端会尝试读取 ANTHROPIC_API_KEY。',
    modelHint: '推荐使用 claude-sonnet-4-6。',
    keyPlaceholder: 'sk-ant-...',
  },
  minimax: {
    label: 'MiniMax',
    defaultModel: 'MiniMax-M2.7',
    providerHint: '通过 Anthropic 兼容接口调用 MiniMax，流程与 Anthropic 保持一致。',
    keyHint: '如果留空，后端会尝试读取 MINIMAX_API_KEY。',
    modelHint: '推荐使用 MiniMax-M2.7。',
    keyPlaceholder: '输入你的 MiniMax API Key',
  },
};

const STEP_PROGRESS: Record<Exclude<Step, 0>, number> = {
  1: 12,
  2: 28,
  3: 52,
  4: 72,
  5: 88,
};

const STEP_LABELS: Array<{step: Exclude<Step, 0>; label: string}> = [
  {step: 1, label: '解析模板'},
  {step: 2, label: '方案确认'},
  {step: 3, label: '生成 TSX'},
  {step: 4, label: '打包工程'},
  {step: 5, label: '渲染 MP4'},
];

const SETTINGS_STORAGE_KEY = 'templateAgent.settings.v1';

type StoredSettings = {
  provider?: ProviderId;
  apiKey?: string;
  model?: string;
};

function loadStoredSettings(): StoredSettings | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSettings;
    if (parsed && typeof parsed === 'object') return parsed;
    return null;
  } catch {
    return null;
  }
}

function saveStoredSettings(value: StoredSettings) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // ignore quota / privacy errors
  }
}

function clearStoredSettings() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(SETTINGS_STORAGE_KEY);
  } catch {
    // ignore
  }
}

function makeMessageId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function IconPlus() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function IconSettings() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function IconArrowUp() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 19V5M5 12l7-7 7 7" />
    </svg>
  );
}

function IconSparkle() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6z" />
      <path d="M19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8z" />
    </svg>
  );
}

function IconCheck() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12l5 5L20 7" />
    </svg>
  );
}

function PlanPreview({plan}: {plan: VisualPlan | null}) {
  if (!plan) {
    return (
      <div className={styles.sessionPlaceholder}>
        <div className={styles.sessionPlaceholderEyebrow}>Plan Pending</div>
        <p className={styles.sessionPlaceholderText}>Agent 规划中…</p>
      </div>
    );
  }

  const palette = plan.visualStyle?.palette ?? [];
  const scenes = plan.scenes ?? [];

  return (
    <div className={styles.sessionPlanGrid}>
      {plan.title ? (
        <div className={styles.sessionPlanBlock}>
          <div className={styles.sessionPlanLabel}>Title</div>
          <p className={styles.sessionPlanText}>
            <strong>{plan.title}</strong>
            {plan.duration ? <span style={{marginLeft: 8, opacity: 0.6}}>· {plan.duration}</span> : null}
            {plan.canvas ? <span style={{marginLeft: 8, opacity: 0.6}}>· {plan.canvas}</span> : null}
          </p>
        </div>
      ) : null}

      <div className={styles.sessionPlanBlock}>
        <div className={styles.sessionPlanLabel}>整体方案</div>
        <p className={styles.sessionPlanText}>{plan.summary || '暂无摘要。'}</p>
      </div>

      <div className={styles.sessionPlanBlock}>
        <div className={styles.sessionPlanLabel}>模板使用</div>
        <p className={styles.sessionPlanText}>
          {plan.useTemplates ? `参考模板：${plan.templateNotes || '已使用所选模板风格'}` : '不使用模板，纯原创'}
        </p>
      </div>

      {palette.length > 0 ? (
        <div className={styles.sessionPlanBlock}>
          <div className={styles.sessionPlanLabel}>配色</div>
          <div style={{display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center'}}>
            {palette.map((color) => (
              <span key={color} style={{display: 'inline-flex', alignItems: 'center', gap: 6}}>
                <span
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: 6,
                    background: color,
                    border: '1px solid rgba(255,255,255,0.15)',
                  }}
                />
                <span style={{fontFamily: 'var(--font-mono)', fontSize: '0.78rem', opacity: 0.78}}>{color}</span>
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {plan.visualStyle ? (
        <div className={styles.sessionPlanBlock}>
          <div className={styles.sessionPlanLabel}>视觉语言</div>
          <div className={styles.sessionPlanList}>
            {plan.visualStyle.background ? (
              <div className={styles.sessionPlanListItem}>
                <strong>背景</strong>
                <span>{plan.visualStyle.background}</span>
              </div>
            ) : null}
            {plan.visualStyle.typography ? (
              <div className={styles.sessionPlanListItem}>
                <strong>字体</strong>
                <span>{plan.visualStyle.typography}</span>
              </div>
            ) : null}
            {plan.visualStyle.motionStyle ? (
              <div className={styles.sessionPlanListItem}>
                <strong>动效语言</strong>
                <span>{plan.visualStyle.motionStyle}</span>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {scenes.length > 0 ? (
        <div className={styles.sessionPlanBlock}>
          <div className={styles.sessionPlanLabel}>分镜</div>
          <div className={styles.sessionPlanList}>
            {scenes.map((scene, index) => {
              const hasSkill = Boolean(scene.skillSlug && scene.skillSlug.trim());
              const propEntries = scene.props
                ? Object.entries(scene.props).filter(([_, v]) => v !== undefined && v !== null && v !== '')
                : [];
              return (
                <div key={`${scene.name ?? 'scene'}-${index}`} className={styles.sessionPlanListItem}>
                  <strong>
                    {scene.name || `Scene ${index + 1}`}
                    {scene.frames ? ` · ${scene.frames}` : ''}
                    {hasSkill ? (
                      <span
                        style={{
                          marginLeft: 8,
                          padding: '2px 8px',
                          borderRadius: 999,
                          background: 'linear-gradient(135deg, rgba(167,139,250,0.22), rgba(236,72,153,0.22))',
                          border: '1px solid rgba(167,139,250,0.35)',
                          color: '#fafafe',
                          fontSize: '0.7rem',
                          fontFamily: 'var(--font-mono)',
                          letterSpacing: '0.04em',
                        }}
                      >
                        SKILL · {scene.skillSlug}
                      </span>
                    ) : null}
                  </strong>
                  {scene.narrative ? <span>{scene.narrative}</span> : null}
                  {hasSkill && propEntries.length > 0 ? (
                    <span style={{opacity: 0.78, fontFamily: 'var(--font-mono)', fontSize: '0.78rem'}}>
                      {propEntries.map(([k, v]) => (
                        <span key={k} style={{display: 'inline-block', marginRight: 12}}>
                          {k}=<span style={{color: '#a78bfa'}}>{typeof v === 'string' ? `"${v}"` : Array.isArray(v) ? `[${v.length}]` : String(v)}</span>
                        </span>
                      ))}
                    </span>
                  ) : null}
                  {!hasSkill && scene.elements && scene.elements.length > 0 ? (
                    <span style={{opacity: 0.7}}>元素：{scene.elements.join('、')}</span>
                  ) : null}
                  {!hasSkill && scene.motion ? <span style={{opacity: 0.7}}>动效：{scene.motion}</span> : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function HomePage() {
  const promptRef = useRef<HTMLTextAreaElement | null>(null);
  const feedbackRef = useRef<HTMLTextAreaElement | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const completionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previousDefaultModelRef = useRef(PROVIDERS.anthropic.defaultModel);

  const [phase, setPhase] = useState<Phase>('home');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerCategory, setPickerCategory] = useState<string>('全部');
  const [pickerSearch, setPickerSearch] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsHydrated, setSettingsHydrated] = useState(false);

  const [templates, setTemplates] = useState<TemplateReference[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(true);
  const [templatesError, setTemplatesError] = useState('');

  const [selectedTemplateSlugs, setSelectedTemplateSlugs] = useState<string[]>([]);
  const [provider, setProvider] = useState<ProviderId>('anthropic');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState(PROVIDERS.anthropic.defaultModel);
  const [prompt, setPrompt] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  // Plan-phase state
  const [sessionId, setSessionId] = useState('');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [latestPlan, setLatestPlan] = useState<VisualPlan | null>(null);
  const [feedback, setFeedback] = useState('');
  const [planLoading, setPlanLoading] = useState(false);

  // Render-phase state
  const [isRendering, setIsRendering] = useState(false);
  const [currentStep, setCurrentStep] = useState<Step>(0);
  const [progressVisible, setProgressVisible] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState('准备中...');
  const [generatedCode, setGeneratedCode] = useState('');
  const [videoUrl, setVideoUrl] = useState('');
  const [videoPreviewUrl, setVideoPreviewUrl] = useState('');
  const [copyLabel, setCopyLabel] = useState('复制代码');

  const providerConfig = PROVIDERS[provider];
  const selectedTemplates = useMemo(
    () =>
      selectedTemplateSlugs
        .map((slug) => templates.find((t) => t.slug === slug))
        .filter(Boolean) as TemplateReference[],
    [selectedTemplateSlugs, templates],
  );
  const completedVideo = Boolean(videoPreviewUrl) && !isRendering;
  const isPlanning = phase === 'planning';
  const planConfirmed = phase === 'rendering' || phase === 'done';
  const canSendFeedback = isPlanning && !planLoading && feedback.trim().length > 0;
  const canConfirm = isPlanning && !planLoading && Boolean(latestPlan);

  const filteredPickerTemplates = useMemo(() => {
    const q = pickerSearch.trim().toLowerCase();
    return templates.filter((t) => {
      if (pickerCategory !== '全部' && t.category !== pickerCategory) {
        return false;
      }
      if (!q) {
        return true;
      }
      const hay = `${t.title} ${t.description} ${t.fileName} ${t.tags.join(' ')}`.toLowerCase();
      return hay.includes(q);
    });
  }, [templates, pickerCategory, pickerSearch]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setTemplatesLoading(true);
      setTemplatesError('');
      try {
        const response = await fetch('/api/templates');
        const payload = (await response.json()) as TemplateCatalogResponse;
        if (!response.ok) {
          throw new Error(payload.error || `HTTP ${response.status}`);
        }
        if (cancelled) return;
        setTemplates(payload.templates || []);
        setCategories(payload.categories || []);
      } catch (error) {
        if (cancelled) return;
        const msg = error instanceof Error && error.message.trim() ? error.message.trim() : '模板加载失败。';
        setTemplatesError(msg);
      } finally {
        if (!cancelled) setTemplatesLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const stored = loadStoredSettings();
    if (stored) {
      if (stored.provider === 'anthropic' || stored.provider === 'minimax') {
        setProvider(stored.provider);
      }
      if (typeof stored.apiKey === 'string') {
        setApiKey(stored.apiKey);
      }
      if (typeof stored.model === 'string' && stored.model.trim()) {
        setModel(stored.model);
      }
    }
    setSettingsHydrated(true);
  }, []);

  useEffect(() => {
    if (!settingsHydrated) return;
    saveStoredSettings({provider, apiKey, model});
  }, [settingsHydrated, provider, apiKey, model]);

  useEffect(() => {
    const previousDefault = previousDefaultModelRef.current;
    const nextDefault = PROVIDERS[provider].defaultModel;
    setModel((current) => {
      const trimmed = current.trim();
      if (!trimmed || trimmed === previousDefault) {
        return nextDefault;
      }
      return current;
    });
    previousDefaultModelRef.current = nextDefault;
  }, [provider]);

  useEffect(() => {
    const el = promptRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 64), 280)}px`;
  }, [prompt]);

  useEffect(() => {
    const el = feedbackRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 56), 200)}px`;
  }, [feedback]);

  useEffect(() => {
    if (!videoPreviewUrl) return;
    void videoRef.current?.play().catch(() => undefined);
  }, [videoPreviewUrl]);

  useEffect(() => {
    const el = chatScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [chatMessages, planLoading]);

  useEffect(() => {
    return () => {
      if (completionTimeoutRef.current) {
        clearTimeout(completionTimeoutRef.current);
      }
    };
  }, []);

  function resetCompletionTimeout() {
    if (completionTimeoutRef.current) {
      clearTimeout(completionTimeoutRef.current);
      completionTimeoutRef.current = null;
    }
  }

  function applyStep(step: Step) {
    setCurrentStep(step);
  }

  function applyProgress(nextProgress: number, nextStatus: string) {
    setProgress(nextProgress);
    setStatusText(nextStatus);
  }

  function showError(message: string) {
    resetCompletionTimeout();
    setErrorMessage(message);
    setProgressVisible(false);
    setIsRendering(false);
    setPlanLoading(false);
    applyStep(0);
  }

  function showVideo(nextVideoUrl: string) {
    setVideoUrl(nextVideoUrl);
    setVideoPreviewUrl(`${nextVideoUrl}?t=${Date.now()}`);
  }

  function handleStreamEvent(data: StreamEvent) {
    switch (data.event) {
      case 'status': {
        const step = data.step ?? 1;
        applyStep(step);
        applyProgress(
          typeof data.progress === 'number' ? data.progress : STEP_PROGRESS[step as Exclude<Step, 0>] ?? 12,
          data.message ?? '处理中...',
        );
        break;
      }
      case 'agent': {
        const step = data.step ?? 2;
        applyStep(step);
        applyProgress(38, data.message ?? '方案已确认。');
        break;
      }
      case 'code': {
        const step = data.step ?? 3;
        setGeneratedCode(data.code ?? '');
        applyStep(step);
        applyProgress(58, data.message ?? 'TSX 已生成。');
        break;
      }
      case 'complete': {
        const step = data.step ?? 5;
        applyStep(step);
        applyProgress(100, data.message ?? '视频渲染完成。');
        showVideo(data.videoUrl);
        setIsRendering(false);
        setPhase('done');
        resetCompletionTimeout();
        completionTimeoutRef.current = setTimeout(() => {
          setProgressVisible(false);
        }, 1200);
        break;
      }
      case 'error': {
        showError(`请求失败：${data.message ?? 'Unknown error'}`);
        break;
      }
      default:
        break;
    }
  }

  function toggleTemplateSelection(slug: string) {
    let blocked = false;
    setSelectedTemplateSlugs((current) => {
      if (current.includes(slug)) {
        return current.filter((item) => item !== slug);
      }
      if (current.length >= 3) {
        blocked = true;
        return current;
      }
      return [...current, slug];
    });
    if (blocked) {
      setErrorMessage('最多只能选择 3 个模板，请先取消一个再继续。');
      return;
    }
    setErrorMessage('');
  }

  function openPickerFor(category: string) {
    setPickerCategory(category);
    setPickerSearch('');
    setPickerOpen(true);
  }

  function backToHome() {
    setPhase('home');
    resetCompletionTimeout();
    setProgressVisible(false);
    setIsRendering(false);
    setPlanLoading(false);
    setSessionId('');
    setChatMessages([]);
    setLatestPlan(null);
    setFeedback('');
    setGeneratedCode('');
    setVideoUrl('');
    setVideoPreviewUrl('');
    setErrorMessage('');
    applyStep(0);
  }

  async function startPlan() {
    const trimmedPrompt = prompt.trim();
    if (templatesLoading) {
      showError('模板还在加载中，请稍等。');
      return;
    }
    if (!trimmedPrompt) {
      promptRef.current?.focus();
      showError('请输入你的想法。');
      return;
    }

    setErrorMessage('');
    setPhase('planning');
    setPlanLoading(true);
    setSessionId('');
    setChatMessages([
      {
        id: makeMessageId(),
        role: 'user',
        content: trimmedPrompt,
      },
    ]);
    setLatestPlan(null);

    try {
      const response = await fetch('/api/plan/start', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          prompt: trimmedPrompt,
          provider,
          apiKey: apiKey.trim(),
          model: model.trim(),
          selectedTemplateSlugs,
        }),
      });

      const contentType = response.headers.get('content-type') || '';
      if (!response.ok) {
        let msg = `HTTP ${response.status}`;
        if (contentType.includes('application/json')) {
          const payload = (await response.json()) as {error?: string};
          if (payload.error) msg = payload.error;
        }
        throw new Error(msg);
      }

      const payload = (await response.json()) as PlanResponse;
      setSessionId(payload.sessionId);
      setLatestPlan(payload.plan);
      setChatMessages((current) => [
        ...current,
        {
          id: makeMessageId(),
          role: 'assistant',
          content: payload.agentMessage,
          plan: payload.plan,
        },
      ]);
    } catch (error) {
      const message = error instanceof Error && error.message.trim() ? error.message.trim() : '请求失败。';
      setErrorMessage(message);
      // Stay on planning view but allow retry by going back
    } finally {
      setPlanLoading(false);
    }
  }

  async function submitFeedback() {
    const trimmed = feedback.trim();
    if (!trimmed || !sessionId || planLoading) return;

    setErrorMessage('');
    setChatMessages((current) => [
      ...current,
      {id: makeMessageId(), role: 'user', content: trimmed},
    ]);
    setFeedback('');
    setPlanLoading(true);

    try {
      const response = await fetch('/api/plan/feedback', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({sessionId, feedback: trimmed}),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as {error?: string};
        throw new Error(payload.error || `HTTP ${response.status}`);
      }

      const payload = (await response.json()) as PlanResponse;
      setLatestPlan(payload.plan);
      setChatMessages((current) => [
        ...current,
        {
          id: makeMessageId(),
          role: 'assistant',
          content: payload.agentMessage,
          plan: payload.plan,
        },
      ]);
    } catch (error) {
      const message = error instanceof Error && error.message.trim() ? error.message.trim() : '请求失败。';
      setErrorMessage(message);
    } finally {
      setPlanLoading(false);
    }
  }

  async function confirmAndRender() {
    if (!sessionId || !latestPlan) return;

    setErrorMessage('');
    setPhase('rendering');
    setIsRendering(true);
    setProgressVisible(true);
    setGeneratedCode('');
    setVideoUrl('');
    setVideoPreviewUrl('');
    applyStep(2);
    applyProgress(38, '方案已确认，开始生成 TSX...');

    try {
      let terminalEventReceived = false;
      const response = await fetch('/api/plan/render', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({sessionId}),
      });

      const contentType = response.headers.get('content-type') || '';
      if (!response.ok && contentType.includes('application/json')) {
        const payload = (await response.json()) as {error?: string};
        throw new Error(payload.error || `HTTP ${response.status}`);
      }
      if (!response.body) {
        throw new Error(`HTTP ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      const processLine = (line: string) => {
        if (!line.startsWith('data: ')) return;
        try {
          const event = JSON.parse(line.slice(6)) as StreamEvent;
          if (event.event === 'complete' || event.event === 'error') {
            terminalEventReceived = true;
          }
          handleStreamEvent(event);
        } catch {
          // ignore malformed
        }
      };

      while (true) {
        const {done, value} = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, {stream: true});
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) processLine(line);
      }
      if (buffer.trim()) processLine(buffer.trim());

      if (!terminalEventReceived) {
        throw new Error('连接在渲染完成前中断了。');
      }
    } catch (error) {
      const message = error instanceof Error && error.message.trim() ? error.message.trim() : '连接失败。';
      showError(message);
    } finally {
      setIsRendering(false);
    }
  }

  async function copyCode() {
    if (!generatedCode) return;
    try {
      await navigator.clipboard.writeText(generatedCode);
      setCopyLabel('已复制');
      setTimeout(() => setCopyLabel('复制代码'), 1800);
    } catch {
      setCopyLabel('复制失败');
      setTimeout(() => setCopyLabel('复制代码'), 1800);
    }
  }

  const canSubmitHome = !planLoading && prompt.trim().length > 0;
  const progressValue = progressVisible ? progress : completedVideo ? 100 : 0;

  return (
    <>
      <Head>
        <title>Remotion Template Agent Studio</title>
        <meta
          name="description"
          content="输入想法，由 Agent 规划画面，确认后再渲染 MP4。"
        />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=JetBrains+Mono:wght@400;500&family=Manrope:wght@400;500;600;700;800&family=Noto+Sans+SC:wght@400;500;700;800&display=swap"
          rel="stylesheet"
        />
      </Head>

      <div className={styles.searchShell} aria-hidden="true" />

      {phase === 'home' ? (
        <main className={styles.searchPage}>
          <div className={styles.searchTopbar}>
            <div className={styles.searchBrand}>
              <span className={styles.searchBrandDot} />
              Template Agent Studio
            </div>
            <div className={styles.searchTopbarRight}>
              <button
                type="button"
                className={styles.iconButton}
                title="模型与 API Key 设置"
                onClick={() => setSettingsOpen(true)}
              >
                <IconSettings />
              </button>
            </div>
          </div>

          <div className={styles.heroWrap}>
            <h1 className={styles.heroHeadline}>
              说出你的想法，<em>让 Agent 先规划再渲染</em>
            </h1>
            <p className={styles.heroSubline}>
              输入想法 → Agent 给出画面/动效方案 → 你确认或反馈调整 → 渲染 MP4。
            </p>

            <form
              className={styles.searchCard}
              onSubmit={(event) => {
                event.preventDefault();
                void startPlan();
              }}
            >
              {selectedTemplates.length > 0 ? (
                <div className={styles.selectedRow}>
                  {selectedTemplates.map((t) => (
                    <span key={t.slug} className={styles.selectedThumb}>
                      <img src={t.thumbnailUrl} alt={t.title} />
                      <span>{t.title}</span>
                      <button
                        type="button"
                        className={styles.selectedThumbRemove}
                        aria-label="移除"
                        onClick={() => toggleTemplateSelection(t.slug)}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              ) : null}

              <textarea
                ref={promptRef}
                className={styles.searchTextarea}
                placeholder="描述你想要的视频，或粘贴一段文案——Agent 会先给方案，你确认后再渲染"
                value={prompt}
                maxLength={1200}
                onChange={(event) => setPrompt(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    void startPlan();
                  }
                }}
              />

              <div className={styles.searchToolbar}>
                <div className={styles.searchToolbarLeft}>
                  <button
                    type="button"
                    className={styles.toolbarPill}
                    onClick={() => openPickerFor('全部')}
                  >
                    <IconPlus />
                    参考模板
                    {selectedTemplates.length > 0 ? (
                      <span className={styles.toolbarPillCount}>
                        {selectedTemplates.length}/3
                      </span>
                    ) : null}
                  </button>
                </div>
                <button
                  type="submit"
                  className={styles.sendButton}
                  disabled={!canSubmitHome}
                  aria-label="开始规划"
                >
                  <IconArrowUp />
                </button>
              </div>
            </form>

            <div className={styles.scenarioRow}>
              {(['全部', ...categories]).map((cat) => (
                <button
                  key={cat}
                  type="button"
                  className={styles.scenarioChip}
                  onClick={() => openPickerFor(cat)}
                >
                  <IconSparkle />
                  {cat}
                </button>
              ))}
            </div>

            {errorMessage ? <div className={styles.heroError}>{errorMessage}</div> : null}
          </div>
        </main>
      ) : (
        <main className={styles.sessionPage}>
          <div className={styles.sessionTopbar}>
            <button type="button" className={styles.drawerGhost} onClick={backToHome}>
              ← 返回
            </button>
            <div className={styles.sessionContext}>
              {selectedTemplates.map((t) => (
                <span key={t.slug} className={styles.sessionContextChip}>
                  {t.title}
                </span>
              ))}
            </div>
            <div className={styles.sessionContext}>
              <span className={styles.sessionContextChip}>{providerConfig.label}</span>
              <span className={styles.sessionContextChip}>
                {phase === 'planning'
                  ? planLoading
                    ? 'PLANNING…'
                    : 'AWAITING CONFIRM'
                  : phase === 'rendering'
                  ? `${Math.round(progressValue)}%`
                  : 'READY'}
              </span>
            </div>
          </div>

          <div className={styles.chatLayout}>
            <section className={`${styles.sessionPanel} ${styles.chatPanel}`}>
              <div className={styles.sessionPanelHeader}>
                <div>
                  <div className={styles.sessionKicker}>Agent A · 视觉规划</div>
                  <div className={styles.sessionPanelTitle}>
                    {planConfirmed ? '方案已确认' : '与视觉总监对话'}
                  </div>
                </div>
              </div>

              <div ref={chatScrollRef} className={styles.chatMessages}>
                {chatMessages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`${styles.chatBubble} ${
                      msg.role === 'user' ? styles.chatBubbleUser : styles.chatBubbleAgent
                    }`.trim()}
                  >
                    <div className={styles.chatBubbleRole}>
                      {msg.role === 'user' ? '你' : 'Agent'}
                    </div>
                    <div className={styles.chatBubbleBody}>{msg.content}</div>
                  </div>
                ))}
                {planLoading ? (
                  <div className={`${styles.chatBubble} ${styles.chatBubbleAgent}`}>
                    <div className={styles.chatBubbleRole}>Agent</div>
                    <div className={styles.chatBubbleBody}>
                      <span className={styles.chatTyping}>规划中</span>
                    </div>
                  </div>
                ) : null}
              </div>

              {isPlanning ? (
                <form
                  className={styles.chatComposer}
                  onSubmit={(event) => {
                    event.preventDefault();
                    void submitFeedback();
                  }}
                >
                  <textarea
                    ref={feedbackRef}
                    className={styles.chatInput}
                    placeholder={
                      sessionId
                        ? '反馈：希望开场更安静 / 配色再冷一点 / ...（Enter 发送，Shift+Enter 换行）'
                        : '正在生成首版方案...'
                    }
                    value={feedback}
                    disabled={!sessionId || planLoading}
                    maxLength={1000}
                    onChange={(event) => setFeedback(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
                        void submitFeedback();
                      }
                    }}
                  />
                  <div className={styles.chatComposerActions}>
                    <button
                      type="submit"
                      className={styles.sessionGhost}
                      disabled={!canSendFeedback}
                    >
                      发送反馈
                    </button>
                    <button
                      type="button"
                      className={styles.chatConfirm}
                      disabled={!canConfirm}
                      onClick={() => void confirmAndRender()}
                    >
                      确认方案，开始渲染 →
                    </button>
                  </div>
                </form>
              ) : null}

              {errorMessage ? <div className={styles.sessionInlineError}>{errorMessage}</div> : null}
            </section>

            <section className={`${styles.sessionPanel} ${styles.planPreviewPanel}`}>
              <div className={styles.sessionPanelHeader}>
                <div>
                  <div className={styles.sessionKicker}>Visual Plan</div>
                  <div className={styles.sessionPanelTitle}>
                    {latestPlan?.title ? latestPlan.title : '当前方案'}
                  </div>
                </div>
              </div>
              <PlanPreview plan={latestPlan} />
            </section>
          </div>

          {planConfirmed ? (
            <>
              <section className={styles.sessionPanel}>
                <div className={styles.sessionPanelHeader}>
                  <div>
                    <div className={styles.sessionKicker}>Run Status</div>
                    <div className={styles.sessionPanelTitle}>{statusText}</div>
                  </div>
                </div>
                <div className={styles.sessionStatusBar}>
                  <div className={styles.sessionStatusBarFill} style={{width: `${progressValue}%`}} />
                </div>
                <div className={styles.sessionStatusList}>
                  {STEP_LABELS.map(({step, label}) => {
                    const isDone = completedVideo || currentStep > step;
                    const isActive = progressVisible && currentStep === step;
                    return (
                      <div
                        key={step}
                        className={`${styles.sessionStatusItem} ${isDone ? styles.sessionStatusItemDone : ''} ${isActive ? styles.sessionStatusItemActive : ''}`.trim()}
                      >
                        <span className={styles.sessionStatusDot} />
                        <span>0{step} · {label}</span>
                      </div>
                    );
                  })}
                </div>
              </section>

              <section className={`${styles.sessionPanel} ${styles.sessionVideoPanel}`}>
                <div className={styles.sessionPanelHeader}>
                  <div>
                    <div className={styles.sessionKicker}>Render Preview</div>
                    <div className={styles.sessionPanelTitle}>视频结果</div>
                  </div>
                  {videoUrl ? (
                    <a className={styles.sessionDownload} href={videoUrl} download>
                      下载 MP4
                    </a>
                  ) : null}
                </div>
                {videoPreviewUrl ? (
                  <video ref={videoRef} className={styles.sessionVideoPlayer} src={videoPreviewUrl} controls />
                ) : (
                  <div className={styles.sessionPlaceholder}>
                    <div className={styles.sessionPlaceholderEyebrow}>Video Pending</div>
                    <p className={styles.sessionPlaceholderText}>渲染完成后会出现在这里。</p>
                  </div>
                )}
              </section>

              <section className={styles.sessionPanel}>
                <div className={styles.sessionPanelHeader}>
                  <div>
                    <div className={styles.sessionKicker}>Code Output</div>
                    <div className={styles.sessionPanelTitle}>Generated.tsx</div>
                  </div>
                  <button
                    type="button"
                    className={styles.sessionGhost}
                    onClick={() => void copyCode()}
                    disabled={!generatedCode}
                  >
                    {copyLabel}
                  </button>
                </div>
                {generatedCode ? (
                  <pre className={styles.sessionCodeBlock}>{generatedCode}</pre>
                ) : (
                  <div className={styles.sessionPlaceholder}>
                    <div className={styles.sessionPlaceholderEyebrow}>Code Pending</div>
                    <p className={styles.sessionPlaceholderText}>Agent B 生成中…</p>
                  </div>
                )}
              </section>
            </>
          ) : null}
        </main>
      )}

      {pickerOpen ? (
        <>
          <div className={styles.drawerBackdrop} onClick={() => setPickerOpen(false)} />
          <aside className={styles.drawer}>
            <div className={styles.drawerHeader}>
              <div>
                <h3 className={styles.drawerTitle}>选择参考模板</h3>
                <div className={styles.drawerSubtitle}>
                  最多 3 个 · 当前 {selectedTemplateSlugs.length}/3 · 是否使用由 Agent 决定
                </div>
              </div>
              <button type="button" className={styles.drawerGhost} onClick={() => setPickerOpen(false)}>
                完成
              </button>
            </div>
            <div className={styles.drawerBody}>
              <div className={styles.drawerFilterRow}>
                {(['全部', ...categories]).map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    className={`${styles.drawerCatChip} ${pickerCategory === cat ? styles.drawerCatChipActive : ''}`.trim()}
                    onClick={() => setPickerCategory(cat)}
                  >
                    {cat}
                  </button>
                ))}
                <input
                  className={styles.drawerSearchInput}
                  type="text"
                  placeholder="搜索标题、标签…"
                  value={pickerSearch}
                  onChange={(event) => setPickerSearch(event.target.value)}
                />
              </div>

              {templatesLoading ? <div className={styles.emptyCard}>正在加载…</div> : null}
              {templatesError ? <div className={styles.emptyCard}>{templatesError}</div> : null}
              {!templatesLoading && !templatesError && filteredPickerTemplates.length === 0 ? (
                <div className={styles.emptyCard}>没有匹配的模板。</div>
              ) : null}

              <div className={styles.pickGrid}>
                {filteredPickerTemplates.map((t) => {
                  const isSelected = selectedTemplateSlugs.includes(t.slug);
                  return (
                    <article
                      key={t.slug}
                      className={`${styles.pickCard} ${isSelected ? styles.pickCardSelected : ''}`.trim()}
                      onClick={() => toggleTemplateSelection(t.slug)}
                    >
                      <div className={styles.pickMedia}>
                        <img src={t.thumbnailUrl} alt={t.title} loading="lazy" />
                        <span className={styles.pickCheck}>{isSelected ? <IconCheck /> : ''}</span>
                      </div>
                      <div className={styles.pickBody}>
                        <h4 className={styles.pickTitle}>{t.title}</h4>
                        <div className={styles.pickMeta}>{t.category}</div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          </aside>
        </>
      ) : null}

      {settingsOpen ? (
        <>
          <div className={styles.drawerBackdrop} onClick={() => setSettingsOpen(false)} />
          <aside className={`${styles.drawer} ${styles.drawerNarrow}`}>
            <div className={styles.drawerHeader}>
              <div>
                <h3 className={styles.drawerTitle}>模型与 API Key</h3>
                <div className={styles.drawerSubtitle}>
                  自动保存到浏览器 localStorage，下次打开自动填入
                </div>
              </div>
              <button type="button" className={styles.drawerGhost} onClick={() => setSettingsOpen(false)}>
                完成
              </button>
            </div>
            <div className={styles.drawerBody}>
              <label className={styles.drawerField}>
                <span className={styles.drawerLabel}>Provider</span>
                <select
                  className={styles.drawerSelect}
                  value={provider}
                  onChange={(event) => setProvider(event.target.value as ProviderId)}
                >
                  <option value="anthropic">Anthropic</option>
                  <option value="minimax">MiniMax</option>
                </select>
                <span className={styles.drawerHint}>{providerConfig.providerHint}</span>
              </label>
              <label className={styles.drawerField}>
                <span className={styles.drawerLabel}>
                  API Key
                  {apiKey.trim() ? <span className={styles.savedBadge}>已保存</span> : null}
                </span>
                <input
                  className={styles.drawerInput}
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={providerConfig.keyPlaceholder}
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                />
                <span className={styles.drawerHint}>{providerConfig.keyHint}</span>
              </label>
              <label className={styles.drawerField}>
                <span className={styles.drawerLabel}>Model</span>
                <input
                  className={styles.drawerInput}
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  value={model}
                  onChange={(event) => setModel(event.target.value)}
                />
                <span className={styles.drawerHint}>{providerConfig.modelHint}</span>
              </label>
              <button
                type="button"
                className={styles.drawerGhost}
                onClick={() => {
                  clearStoredSettings();
                  setApiKey('');
                  setProvider('anthropic');
                  setModel(PROVIDERS.anthropic.defaultModel);
                }}
              >
                清除已保存的设置
              </button>
            </div>
          </aside>
        </>
      ) : null}
    </>
  );
}
