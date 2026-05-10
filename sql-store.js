const fs = require('node:fs');
const path = require('node:path');
const {DatabaseSync} = require('node:sqlite');

const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'remotion-ai.sqlite');

let database = null;

function nowIso() {
  return new Date().toISOString();
}

function toJson(value, fallback = null) {
  if (value == null) {
    return fallback;
  }

  return JSON.stringify(value);
}

function parseJson(value, fallback) {
  if (typeof value !== 'string' || !value.trim()) {
    return fallback;
  }

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function ensureDatabase() {
  if (database) {
    return database;
  }

  fs.mkdirSync(DATA_DIR, {recursive: true});

  const db = new DatabaseSync(DB_PATH);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS template_catalog_meta (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS templates (
      slug TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      date TEXT,
      tags_json TEXT NOT NULL DEFAULT '[]',
      file_name TEXT,
      category TEXT,
      prompt TEXT,
      featured INTEGER NOT NULL DEFAULT 0,
      template_url TEXT,
      code_status TEXT,
      preview_video_url TEXT,
      thumbnail_url TEXT,
      synced_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_templates_category ON templates(category);
    CREATE INDEX IF NOT EXISTS idx_templates_title ON templates(title);

    CREATE TABLE IF NOT EXISTS generation_jobs (
      job_id TEXT PRIMARY KEY,
      prompt TEXT NOT NULL,
      provider TEXT NOT NULL,
      provider_label TEXT,
      model TEXT,
      status TEXT NOT NULL,
      step INTEGER NOT NULL DEFAULT 0,
      progress INTEGER NOT NULL DEFAULT 0,
      status_text TEXT,
      error_message TEXT,
      selected_template_slugs_json TEXT NOT NULL DEFAULT '[]',
      selected_templates_json TEXT NOT NULL DEFAULT '[]',
      agent_plan_json TEXT,
      generated_code TEXT,
      video_url TEXT,
      render_output_path TEXT,
      started_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_generation_jobs_started_at ON generation_jobs(started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_generation_jobs_status ON generation_jobs(status);

    CREATE TABLE IF NOT EXISTS generation_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      step INTEGER,
      progress INTEGER,
      message TEXT,
      payload_json TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(job_id) REFERENCES generation_jobs(job_id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_generation_events_job_id ON generation_events(job_id, created_at ASC);

    CREATE TABLE IF NOT EXISTS skills (
      slug TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT,
      intent TEXT,
      input_schema_json TEXT NOT NULL DEFAULT '{}',
      defaults_json TEXT NOT NULL DEFAULT '{}',
      frame_range INTEGER NOT NULL DEFAULT 90,
      motion_style TEXT,
      code_template TEXT NOT NULL,
      example_props_json TEXT NOT NULL DEFAULT '{}',
      tags_json TEXT NOT NULL DEFAULT '[]',
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_skills_category ON skills(category);
    CREATE INDEX IF NOT EXISTS idx_skills_enabled ON skills(enabled);
  `);

  database = db;
  return db;
}

function runInTransaction(task) {
  const db = ensureDatabase();
  db.exec('BEGIN');

  try {
    const result = task(db);
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function setMetaValue(key, value) {
  const db = ensureDatabase();
  db.prepare(`
    INSERT INTO template_catalog_meta (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at
  `).run(key, value, nowIso());
}

function getTemplateCatalogMeta() {
  const db = ensureDatabase();
  const rows = db.prepare('SELECT key, value, updated_at FROM template_catalog_meta').all();
  const meta = {};

  for (const row of rows) {
    meta[row.key] = row.value;
  }

  return {
    source: meta.catalog_source || '',
    fetchedAt: meta.catalog_fetched_at || '',
    fileSignature: meta.catalog_file_signature || '',
    lastSyncedAt: meta.catalog_last_synced_at || '',
    templateCount: Number(meta.catalog_template_count || 0),
  };
}

function normalizeTemplateRow(row) {
  return {
    slug: row.slug,
    title: row.title,
    description: row.description,
    date: row.date,
    tags: parseJson(row.tags_json, []),
    fileName: row.file_name,
    category: row.category,
    prompt: row.prompt,
    featured: Boolean(row.featured),
    templateUrl: row.template_url,
    codeStatus: row.code_status,
    previewVideoUrl: row.preview_video_url,
    thumbnailUrl: row.thumbnail_url,
  };
}

function getTemplateCatalogFromDb() {
  const db = ensureDatabase();
  const templates = db.prepare(`
    SELECT
      slug,
      title,
      description,
      date,
      tags_json,
      file_name,
      category,
      prompt,
      featured,
      template_url,
      code_status,
      preview_video_url,
      thumbnail_url
    FROM templates
    ORDER BY category COLLATE NOCASE ASC, title COLLATE NOCASE ASC
  `).all().map(normalizeTemplateRow);

  const meta = getTemplateCatalogMeta();

  return {
    source: meta.source,
    fetchedAt: meta.fetchedAt,
    templateCount: templates.length,
    categories: Array.from(new Set(templates.map((template) => template.category))).filter(Boolean),
    templates,
  };
}

function upsertTemplateCatalog(catalog, options = {}) {
  const fileSignature = options.fileSignature || '';
  const syncedAt = nowIso();

  return runInTransaction((db) => {
    const upsertTemplate = db.prepare(`
      INSERT INTO templates (
        slug,
        title,
        description,
        date,
        tags_json,
        file_name,
        category,
        prompt,
        featured,
        template_url,
        code_status,
        preview_video_url,
        thumbnail_url,
        synced_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(slug) DO UPDATE SET
        title = excluded.title,
        description = excluded.description,
        date = excluded.date,
        tags_json = excluded.tags_json,
        file_name = excluded.file_name,
        category = excluded.category,
        prompt = excluded.prompt,
        featured = excluded.featured,
        template_url = excluded.template_url,
        code_status = excluded.code_status,
        preview_video_url = excluded.preview_video_url,
        thumbnail_url = excluded.thumbnail_url,
        synced_at = excluded.synced_at
    `);

    for (const template of catalog.templates || []) {
      upsertTemplate.run(
        template.slug,
        template.title,
        template.description || '',
        template.date || null,
        toJson(template.tags || [], '[]'),
        template.fileName || null,
        template.category || null,
        template.prompt || null,
        template.featured ? 1 : 0,
        template.templateUrl || null,
        template.codeStatus || null,
        template.previewVideoUrl || null,
        template.thumbnailUrl || null,
        syncedAt,
      );
    }

    const currentSlugs = (catalog.templates || []).map((template) => template.slug);
    if (currentSlugs.length > 0) {
      const placeholders = currentSlugs.map(() => '?').join(', ');
      db.prepare(`DELETE FROM templates WHERE slug NOT IN (${placeholders})`).run(...currentSlugs);
    } else {
      db.exec('DELETE FROM templates');
    }

    setMetaValue('catalog_source', catalog.source || '');
    setMetaValue('catalog_fetched_at', catalog.fetchedAt || '');
    setMetaValue('catalog_template_count', String(catalog.templateCount || currentSlugs.length));
    setMetaValue('catalog_file_signature', fileSignature);
    setMetaValue('catalog_last_synced_at', syncedAt);

    return getTemplateCatalogFromDb();
  });
}

function normalizeJobRow(row) {
  if (!row) {
    return null;
  }

  return {
    jobId: row.job_id,
    prompt: row.prompt,
    provider: row.provider,
    providerLabel: row.provider_label,
    model: row.model,
    status: row.status,
    step: row.step,
    progress: row.progress,
    statusText: row.status_text,
    errorMessage: row.error_message,
    selectedTemplateSlugs: parseJson(row.selected_template_slugs_json, []),
    selectedTemplates: parseJson(row.selected_templates_json, []),
    agentPlan: parseJson(row.agent_plan_json, null),
    generatedCode: row.generated_code || '',
    videoUrl: row.video_url || '',
    renderOutputPath: row.render_output_path || '',
    startedAt: row.started_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

function createGenerationJob({
  jobId,
  prompt,
  provider,
  providerLabel,
  model,
  selectedTemplateSlugs,
  selectedTemplates,
}) {
  const db = ensureDatabase();
  const timestamp = nowIso();

  db.prepare(`
    INSERT INTO generation_jobs (
      job_id,
      prompt,
      provider,
      provider_label,
      model,
      status,
      step,
      progress,
      status_text,
      selected_template_slugs_json,
      selected_templates_json,
      started_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    jobId,
    prompt,
    provider,
    providerLabel || null,
    model || null,
    'queued',
    0,
    0,
    'Job created.',
    toJson(selectedTemplateSlugs || [], '[]'),
    toJson(selectedTemplates || [], '[]'),
    timestamp,
    timestamp,
  );

  return getGenerationJob(jobId);
}

function updateGenerationJobProgress({jobId, status, step, progress, statusText}) {
  const db = ensureDatabase();
  db.prepare(`
    UPDATE generation_jobs
    SET
      status = ?,
      step = ?,
      progress = ?,
      status_text = ?,
      updated_at = ?
    WHERE job_id = ?
  `).run(
    status,
    typeof step === 'number' ? step : 0,
    typeof progress === 'number' ? progress : 0,
    statusText || null,
    nowIso(),
    jobId,
  );
}

function saveGenerationJobAgentPlan(jobId, agentPlan) {
  const db = ensureDatabase();
  db.prepare(`
    UPDATE generation_jobs
    SET
      agent_plan_json = ?,
      updated_at = ?
    WHERE job_id = ?
  `).run(toJson(agentPlan, null), nowIso(), jobId);
}

function saveGenerationJobCode(jobId, code) {
  const db = ensureDatabase();
  db.prepare(`
    UPDATE generation_jobs
    SET
      generated_code = ?,
      updated_at = ?
    WHERE job_id = ?
  `).run(code || '', nowIso(), jobId);
}

function completeGenerationJob(jobId, {step, progress, statusText, videoUrl, renderOutputPath}) {
  const db = ensureDatabase();
  const timestamp = nowIso();
  db.prepare(`
    UPDATE generation_jobs
    SET
      status = 'completed',
      step = ?,
      progress = ?,
      status_text = ?,
      video_url = ?,
      render_output_path = ?,
      updated_at = ?,
      completed_at = ?
    WHERE job_id = ?
  `).run(
    typeof step === 'number' ? step : 5,
    typeof progress === 'number' ? progress : 100,
    statusText || 'Video render complete.',
    videoUrl || null,
    renderOutputPath || null,
    timestamp,
    timestamp,
    jobId,
  );
}

function failGenerationJob(jobId, {step = 0, progress = 0, statusText = 'Job failed.', errorMessage}) {
  const db = ensureDatabase();
  db.prepare(`
    UPDATE generation_jobs
    SET
      status = 'failed',
      step = ?,
      progress = ?,
      status_text = ?,
      error_message = ?,
      updated_at = ?
    WHERE job_id = ?
  `).run(step, progress, statusText, errorMessage || statusText, nowIso(), jobId);
}

function insertGenerationEvent({jobId, eventType, step = null, progress = null, message = null, payload = null}) {
  const db = ensureDatabase();
  db.prepare(`
    INSERT INTO generation_events (
      job_id,
      event_type,
      step,
      progress,
      message,
      payload_json,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    jobId,
    eventType,
    typeof step === 'number' ? step : null,
    typeof progress === 'number' ? progress : null,
    message,
    toJson(payload, null),
    nowIso(),
  );
}

function listGenerationJobs(limit = 20) {
  const db = ensureDatabase();
  return db.prepare(`
    SELECT
      job_id,
      prompt,
      provider,
      provider_label,
      model,
      status,
      step,
      progress,
      status_text,
      error_message,
      selected_template_slugs_json,
      selected_templates_json,
      agent_plan_json,
      generated_code,
      video_url,
      render_output_path,
      started_at,
      updated_at,
      completed_at
    FROM generation_jobs
    ORDER BY started_at DESC
    LIMIT ?
  `).all(limit).map((row) => {
    const job = normalizeJobRow(row);
    return {
      ...job,
      generatedCode: undefined,
    };
  });
}

function getGenerationJobEvents(jobId) {
  const db = ensureDatabase();
  return db.prepare(`
    SELECT id, event_type, step, progress, message, payload_json, created_at
    FROM generation_events
    WHERE job_id = ?
    ORDER BY created_at ASC, id ASC
  `).all(jobId).map((row) => ({
    id: row.id,
    eventType: row.event_type,
    step: row.step,
    progress: row.progress,
    message: row.message,
    payload: parseJson(row.payload_json, null),
    createdAt: row.created_at,
  }));
}

function getGenerationJob(jobId) {
  const db = ensureDatabase();
  const row = db.prepare(`
    SELECT
      job_id,
      prompt,
      provider,
      provider_label,
      model,
      status,
      step,
      progress,
      status_text,
      error_message,
      selected_template_slugs_json,
      selected_templates_json,
      agent_plan_json,
      generated_code,
      video_url,
      render_output_path,
      started_at,
      updated_at,
      completed_at
    FROM generation_jobs
    WHERE job_id = ?
  `).get(jobId);

  const job = normalizeJobRow(row);
  if (!job) {
    return null;
  }

  return {
    ...job,
    events: getGenerationJobEvents(jobId),
  };
}

function normalizeSkillRow(row) {
  if (!row) return null;
  return {
    slug: row.slug,
    name: row.name,
    category: row.category,
    intent: row.intent,
    inputSchema: parseJson(row.input_schema_json, {}),
    defaults: parseJson(row.defaults_json, {}),
    frameRange: row.frame_range,
    motionStyle: row.motion_style,
    codeTemplate: row.code_template,
    exampleProps: parseJson(row.example_props_json, {}),
    tags: parseJson(row.tags_json, []),
    enabled: Boolean(row.enabled),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function upsertSkill(skill) {
  const db = ensureDatabase();
  const now = nowIso();
  db.prepare(`
    INSERT INTO skills (
      slug, name, category, intent,
      input_schema_json, defaults_json, frame_range, motion_style,
      code_template, example_props_json, tags_json, enabled,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(slug) DO UPDATE SET
      name = excluded.name,
      category = excluded.category,
      intent = excluded.intent,
      input_schema_json = excluded.input_schema_json,
      defaults_json = excluded.defaults_json,
      frame_range = excluded.frame_range,
      motion_style = excluded.motion_style,
      code_template = excluded.code_template,
      example_props_json = excluded.example_props_json,
      tags_json = excluded.tags_json,
      enabled = excluded.enabled,
      updated_at = excluded.updated_at
  `).run(
    skill.slug,
    skill.name,
    skill.category || null,
    skill.intent || null,
    toJson(skill.inputSchema || {}, '{}'),
    toJson(skill.defaults || {}, '{}'),
    typeof skill.frameRange === 'number' ? skill.frameRange : 90,
    skill.motionStyle || null,
    skill.codeTemplate,
    toJson(skill.exampleProps || {}, '{}'),
    toJson(skill.tags || [], '[]'),
    skill.enabled === false ? 0 : 1,
    now,
    now,
  );
}

function seedSkills(skills) {
  return runInTransaction(() => {
    for (const skill of skills) {
      upsertSkill(skill);
    }
    return skills.length;
  });
}

function listSkills({enabledOnly = true, category = null} = {}) {
  const db = ensureDatabase();
  const conditions = [];
  const params = [];
  if (enabledOnly) {
    conditions.push('enabled = 1');
  }
  if (category) {
    conditions.push('category = ?');
    params.push(category);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  return db.prepare(`
    SELECT slug, name, category, intent,
           input_schema_json, defaults_json, frame_range, motion_style,
           code_template, example_props_json, tags_json, enabled,
           created_at, updated_at
    FROM skills
    ${where}
    ORDER BY category COLLATE NOCASE ASC, name COLLATE NOCASE ASC
  `).all(...params).map(normalizeSkillRow);
}

function getSkillBySlug(slug) {
  const db = ensureDatabase();
  const row = db.prepare(`
    SELECT slug, name, category, intent,
           input_schema_json, defaults_json, frame_range, motion_style,
           code_template, example_props_json, tags_json, enabled,
           created_at, updated_at
    FROM skills
    WHERE slug = ?
  `).get(slug);
  return normalizeSkillRow(row);
}

function getDatabaseSummary() {
  const db = ensureDatabase();
  const templateCount = db.prepare('SELECT COUNT(*) AS count FROM templates').get().count;
  const jobCount = db.prepare('SELECT COUNT(*) AS count FROM generation_jobs').get().count;
  const skillCount = db.prepare('SELECT COUNT(*) AS count FROM skills').get().count;
  const recentJob = db.prepare('SELECT job_id, status, updated_at FROM generation_jobs ORDER BY updated_at DESC LIMIT 1').get();
  const meta = getTemplateCatalogMeta();

  return {
    path: DB_PATH,
    templateCount,
    jobCount,
    skillCount,
    catalogFetchedAt: meta.fetchedAt,
    catalogLastSyncedAt: meta.lastSyncedAt,
    recentJob: recentJob
      ? {
          jobId: recentJob.job_id,
          status: recentJob.status,
          updatedAt: recentJob.updated_at,
        }
      : null,
  };
}

module.exports = {
  DB_PATH,
  createGenerationJob,
  completeGenerationJob,
  ensureDatabase,
  failGenerationJob,
  getDatabaseSummary,
  getGenerationJob,
  getSkillBySlug,
  getTemplateCatalogFromDb,
  getTemplateCatalogMeta,
  insertGenerationEvent,
  listGenerationJobs,
  listSkills,
  saveGenerationJobAgentPlan,
  saveGenerationJobCode,
  seedSkills,
  updateGenerationJobProgress,
  upsertSkill,
  upsertTemplateCatalog,
};
