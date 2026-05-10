#!/usr/bin/env node

const fs = require("node:fs/promises");
const path = require("node:path");

const SHOWCASE_URL = "https://remotionlab.com/showcase";
const TARGET_CATEGORIES = new Map([
  ["Logo 動畫", "logo-animation"],
  ["片頭/片尾", "intro-outro"],
  ["文字特效", "text-effects"],
]);

const DEFAULT_OUTPUT_DIR = path.resolve(
  process.cwd(),
  "downloads",
  "remotionlab-public"
);

const args = process.argv.slice(2);
const outDirArgIndex = args.findIndex((arg) => arg === "--out");
const OUTPUT_DIR =
  outDirArgIndex >= 0 && args[outDirArgIndex + 1]
    ? path.resolve(process.cwd(), args[outDirArgIndex + 1])
    : DEFAULT_OUTPUT_DIR;

const now = new Date();

const main = async () => {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  const html = await fetchText(SHOWCASE_URL);
  const flightText = extractNextFlightText(html);
  const templates = extractTemplates(flightText);

  const filtered = templates.filter((template) =>
    TARGET_CATEGORIES.has(template.category)
  );

  if (filtered.length === 0) {
    throw new Error("No matching public templates were found.");
  }

  const grouped = groupByCategory(filtered);
  const summary = [];

  for (const [categoryName, folderName] of TARGET_CATEGORIES.entries()) {
    const categoryTemplates = grouped.get(categoryName) ?? [];
    const categoryDir = path.join(OUTPUT_DIR, folderName);

    await fs.mkdir(categoryDir, { recursive: true });
    await writeCategoryManifest(categoryDir, categoryName, categoryTemplates);

    for (const template of categoryTemplates) {
      const templateDir = path.join(categoryDir, template.slug);
      await fs.mkdir(templateDir, { recursive: true });

      const templateUrl = `https://remotionlab.com/showcase/${template.slug}`;
      const metadata = {
        ...template,
        templateUrl,
        sourceAccess: "public showcase metadata only",
        codeStatus: "locked behind site login; not downloaded",
      };

      await fs.writeFile(
        path.join(templateDir, "metadata.json"),
        `${JSON.stringify(metadata, null, 2)}\n`,
        "utf8"
      );

      if (template.prompt) {
        await fs.writeFile(
          path.join(templateDir, "prompt.txt"),
          `${template.prompt.trim()}\n`,
          "utf8"
        );
      }

      const downloads = [];

      if (template.video) {
        downloads.push(
          downloadFile(template.video, path.join(templateDir, "preview.mp4"))
        );
      }

      if (template.thumbnail) {
        const thumbExt = path.extname(new URL(template.thumbnail).pathname) || ".jpg";
        downloads.push(
          downloadFile(
            template.thumbnail,
            path.join(templateDir, `thumbnail${thumbExt}`)
          )
        );
      }

      await Promise.all(downloads);
    }

    summary.push({
      category: categoryName,
      folder: folderName,
      count: categoryTemplates.length,
    });
  }

  await fs.writeFile(
    path.join(OUTPUT_DIR, "catalog.json"),
    `${JSON.stringify(
      {
        source: SHOWCASE_URL,
        fetchedAt: now.toISOString(),
        scope: Array.from(TARGET_CATEGORIES.keys()),
        templateCount: filtered.length,
        templates: filtered.map((template) => ({
          ...template,
          templateUrl: `https://remotionlab.com/showcase/${template.slug}`,
          codeStatus: "locked behind site login; not downloaded",
        })),
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  await fs.writeFile(
    path.join(OUTPUT_DIR, "README.txt"),
    buildReadme(summary, filtered.length),
    "utf8"
  );

  console.log(
    JSON.stringify(
      {
        outputDir: OUTPUT_DIR,
        templateCount: filtered.length,
        categories: summary,
      },
      null,
      2
    )
  );
};

const fetchText = async (url) => {
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }

  return response.text();
};

const downloadFile = async (url, destination) => {
  try {
    await fs.access(destination);
    return;
  } catch {
    // File does not exist yet.
  }

  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(destination, bytes);
};

const extractNextFlightText = (html) => {
  const regex = /self\.__next_f\.push\(\[1,"([\s\S]*?)"\]\)<\/script>/g;
  const chunks = [];

  for (const match of html.matchAll(regex)) {
    const rawChunk = match[1];
    chunks.push(JSON.parse(`"${rawChunk}"`));
  }

  if (chunks.length === 0) {
    throw new Error("Could not locate Next.js flight data.");
  }

  return chunks.join("\n");
};

const extractTemplates = (flightText) => {
  const categoriesMarker = '],"categories":';
  const categoriesIndex = flightText.indexOf(categoriesMarker);

  if (categoriesIndex === -1) {
    throw new Error("Could not find the public categories payload.");
  }

  const arrayStart = flightText.lastIndexOf('[{"title":', categoriesIndex);
  if (arrayStart === -1) {
    throw new Error("Could not find the start of the templates array.");
  }

  const arrayEnd = categoriesIndex + 1;
  const arrayText = flightText.slice(arrayStart, arrayEnd);
  const parsed = JSON.parse(arrayText);

  return parsed.map((item) => ({
    title: item.title,
    description: item.description,
    date: item.date,
    tags: item.tags,
    video: item.video,
    thumbnail: item.thumbnail,
    fileName: item.fileName,
    category: item.category,
    prompt: item.prompt,
    featured: item.featured,
    slug: item.slug,
  }));
};

const groupByCategory = (templates) => {
  const groups = new Map();

  for (const template of templates) {
    if (!groups.has(template.category)) {
      groups.set(template.category, []);
    }

    groups.get(template.category).push(template);
  }

  return groups;
};

const writeCategoryManifest = async (categoryDir, categoryName, templates) => {
  const manifest = {
    category: categoryName,
    fetchedAt: now.toISOString(),
    count: templates.length,
    templates: templates.map((template) => ({
      title: template.title,
      slug: template.slug,
      fileName: template.fileName,
      templateUrl: `https://remotionlab.com/showcase/${template.slug}`,
      tags: template.tags,
      previewVideo: template.video,
      thumbnail: template.thumbnail,
    })),
  };

  await fs.writeFile(
    path.join(categoryDir, "templates.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8"
  );
};

const buildReadme = (summary, templateCount) => {
  const lines = [
    "Remotion Lab public template scrape",
    "",
    `Source: ${SHOWCASE_URL}`,
    `Fetched at: ${now.toISOString()}`,
    "",
    "Included categories:",
    ...summary.map(
      (item) => `- ${item.category} (${item.count}) -> ${item.folder}`
    ),
    "",
    `Total templates saved: ${templateCount}`,
    "",
    "Saved items for each template:",
    "- metadata.json",
    "- prompt.txt",
    "- preview.mp4",
    "- thumbnail image",
    "",
    "Important note:",
    'The detail pages show the message "登入後查看完整程式碼".',
    "This export only includes public showcase metadata and public preview assets.",
    "No login-gated .tsx source code was extracted or downloaded.",
    "",
  ];

  return lines.join("\n");
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
