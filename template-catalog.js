const fs = require('node:fs');
const path = require('node:path');
const {
  getTemplateCatalogFromDb,
  getTemplateCatalogMeta,
  upsertTemplateCatalog,
} = require('./sql-store');

const CATEGORY_FOLDER_BY_NAME = {
  'Logo 動畫': 'logo-animation',
  '片頭/片尾': 'intro-outro',
  '文字特效': 'text-effects',
};

const CATALOG_PATH = path.join(__dirname, 'downloads', 'remotionlab-public', 'catalog.json');

function readCatalogFile() {
  if (!fs.existsSync(CATALOG_PATH)) {
    throw new Error(`Template catalog not found at ${CATALOG_PATH}`);
  }

  return JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
}

function getCatalogFileSignature() {
  const stat = fs.statSync(CATALOG_PATH);
  return `${Math.round(stat.mtimeMs)}:${stat.size}`;
}

function getThumbnailExtension(thumbnailUrl) {
  try {
    const extension = path.extname(new URL(thumbnailUrl).pathname);
    return extension || '.jpg';
  } catch {
    return '.jpg';
  }
}

function toPublicTemplate(template) {
  const categoryFolder = CATEGORY_FOLDER_BY_NAME[template.category];
  if (!categoryFolder) {
    return null;
  }

  const thumbnailExtension = getThumbnailExtension(template.thumbnail);
  const assetBasePath = `/downloads/remotionlab-public/${categoryFolder}/${template.slug}`;

  return {
    slug: template.slug,
    title: template.title,
    description: template.description,
    date: template.date,
    tags: Array.isArray(template.tags) ? template.tags : [],
    fileName: template.fileName,
    category: template.category,
    prompt: template.prompt,
    featured: Boolean(template.featured),
    templateUrl: template.templateUrl,
    codeStatus: template.codeStatus || 'locked behind site login; not downloaded',
    previewVideoUrl: `${assetBasePath}/preview.mp4`,
    thumbnailUrl: `${assetBasePath}/thumbnail${thumbnailExtension}`,
  };
}

function buildPublicTemplateCatalog(rawCatalog) {
  const templates = (rawCatalog.templates || [])
    .map(toPublicTemplate)
    .filter(Boolean)
    .sort((left, right) => {
      if (left.category !== right.category) {
        return left.category.localeCompare(right.category, 'zh-Hans-CN');
      }

      return left.title.localeCompare(right.title, 'zh-Hans-CN');
    });

  return {
    source: rawCatalog.source,
    fetchedAt: rawCatalog.fetchedAt,
    templateCount: templates.length,
    categories: Array.from(new Set(templates.map((template) => template.category))),
    templates,
  };
}

function syncTemplateCatalogFromFile() {
  const rawCatalog = readCatalogFile();
  const catalog = buildPublicTemplateCatalog(rawCatalog);
  return upsertTemplateCatalog(catalog, {
    fileSignature: getCatalogFileSignature(),
  });
}

function ensureTemplateCatalogSynced() {
  const storedCatalog = getTemplateCatalogFromDb();
  const meta = getTemplateCatalogMeta();
  let fileSignature = '';

  try {
    fileSignature = getCatalogFileSignature();
  } catch (error) {
    if (storedCatalog.templates.length > 0) {
      return storedCatalog;
    }

    throw error;
  }

  if (storedCatalog.templates.length === 0 || meta.fileSignature !== fileSignature) {
    try {
      return syncTemplateCatalogFromFile();
    } catch (error) {
      if (storedCatalog.templates.length > 0) {
        return storedCatalog;
      }

      throw error;
    }
  }

  return storedCatalog;
}

function getPublicTemplateCatalog() {
  return ensureTemplateCatalogSynced();
}

function resolveTemplateSelection(slugs) {
  const uniqueSlugs = Array.from(new Set((slugs || []).filter((value) => typeof value === 'string' && value.trim())));
  const catalog = ensureTemplateCatalogSynced();
  const templateMap = new Map(catalog.templates.map((template) => [template.slug, template]));

  const selectedTemplates = [];
  const missingSlugs = [];

  for (const slug of uniqueSlugs) {
    const template = templateMap.get(slug);
    if (!template) {
      missingSlugs.push(slug);
      continue;
    }

    selectedTemplates.push(template);
  }

  return {
    catalog,
    uniqueSlugs,
    selectedTemplates,
    missingSlugs,
  };
}

module.exports = {
  CATEGORY_FOLDER_BY_NAME,
  CATALOG_PATH,
  getPublicTemplateCatalog,
  resolveTemplateSelection,
  syncTemplateCatalogFromFile,
};
