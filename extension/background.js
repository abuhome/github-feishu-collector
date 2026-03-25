(function () {
  "use strict";

  const DEFAULT_CONFIG = {
    githubToken: "",
    modelApiMode: "chat_completions",
    openaiBaseUrl: "https://api.openai.com/v1",
    openaiApiKey: "",
    openaiModel: "gpt-4o-mini",
    feishuAppId: "",
    feishuAppSecret: "",
    feishuBitableAppToken: "",
    feishuTableId: "",
    fieldMapping: null
  };

  const DEFAULT_FIELD_MAPPING = {
    title: "标题",
    link: "链接",
    summary: "简介",
    category: "分类",
    stars: "星标",
    forks: "Fork",
    language: "语言",
    topics: "Topics",
    author: "作者",
    repo: "仓库名",
    homepage: "主页",
    updatedAt: "更新时间",
    source: "来源"
  };

  const CATEGORY_OPTIONS = [
    "AI/LLM",
    "Agent/工作流",
    "前端/UI",
    "后端/API",
    "DevOps/运维",
    "数据科学/机器学习",
    "自动化/效率",
    "爬虫/采集",
    "移动端",
    "安全",
    "数据库",
    "教育",
    "其他"
  ];

  const RESERVED_PATHS = new Set([
    "about",
    "account",
    "apps",
    "collections",
    "contact",
    "copilot",
    "customer-stories",
    "enterprise",
    "enterprises",
    "events",
    "explore",
    "features",
    "issues",
    "login",
    "marketplace",
    "new",
    "notifications",
    "orgs",
    "organizations",
    "pricing",
    "pulls",
    "search",
    "settings",
    "signup",
    "site",
    "sponsors",
    "topics",
    "trending"
  ]);

  const LOG_STORAGE_KEY = "runtimeLogs";
  const COLLECTION_INDEX_KEY = "collectionIndex";
  const RECENT_RESULT_KEY = "recentCollectResult";
  const GLOBAL_COLLECTION_TABLE_KEY = "__global__";
  const MAX_LOGS = 120;
  const MAX_COLLECTION_CACHE = 1000;
  const REQUEST_TIMEOUT_MS = 30000;
  const FEISHU_FIELD_TYPE_NUMBER = 2;
  const EXTENSION_VERSION = chrome.runtime.getManifest().version || "dev";

  function mergeConfig(rawConfig) {
    const raw = isPlainObject(rawConfig) ? rawConfig : {};
    return {
      ...DEFAULT_CONFIG,
      ...raw,
      modelApiMode: DEFAULT_CONFIG.modelApiMode,
      fieldMapping: normalizeFieldMapping(raw.fieldMapping)
    };
  }

  function normalizeFieldMapping(input) {
    const raw = isPlainObject(input) ? input : {};
    return Object.fromEntries(
      Object.entries(DEFAULT_FIELD_MAPPING).map(([key, defaultValue]) => [
        key,
        cleanSingleLine(raw[key]) || defaultValue
      ])
    );
  }

  function getFieldMappingIssues(fieldMapping) {
    const normalized = normalizeFieldMapping(fieldMapping);
    const seen = new Set();
    const duplicates = [];

    Object.values(normalized).forEach((value) => {
      const identity = cleanSingleLine(value).toLowerCase();
      if (!identity) {
        return;
      }
      if (seen.has(identity)) {
        duplicates.push(value);
        return;
      }
      seen.add(identity);
    });

    return duplicates;
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || !message.type) {
      return;
    }

    const task =
      message.type === "collectRepo"
        ? handleCollectMessage(message)
        : message.type === "testModel"
          ? handleTestModelMessage(message)
          : message.type === "testFeishu"
            ? handleTestFeishuMessage(message)
            : message.type === "clearCollectionCache"
              ? clearCollectionCache()
              : null;

    if (!task) {
      return;
    }

    task
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch(async (error) => {
        await appendLog("error", "failed", toMessage(error));
        sendResponse({ ok: false, error: toMessage(error) });
      });

    return true;
  });

  async function handleCollectMessage(message) {
    const config = mergeConfig({
      ...(await chrome.storage.local.get(DEFAULT_CONFIG)),
      ...(message && message.config ? message.config : {})
    });

    await appendLog("info", "start", `收到采集请求：${message.repoUrl || "-"} · v${EXTENSION_VERSION}`);

    if (!message.repoUrl) {
      throw new Error("缺少仓库地址");
    }

    await appendLog("info", "mode", `当前使用纯扩展直连模式 · v${EXTENSION_VERSION}`);
    return collectDirectly(config, message.repoUrl);
  }

  async function handleTestModelMessage(message) {
    const config = mergeConfig(message && message.config ? message.config : {});

    const result = await callModelJson(config, {
      systemPrompt: "你是一个接口连通性测试助手，只返回 JSON。",
      userPrompt:
        '{"ok":true,"summary":"请返回一个 JSON，包含 ok=true 和一条 20 字以内的中文 summary。"}'
    });

    return {
      summary: cleanSingleLine(result.summary || JSON.stringify(result)),
      mode: config.modelApiMode || DEFAULT_CONFIG.modelApiMode
    };
  }

  async function handleTestFeishuMessage(message) {
    const config = mergeConfig(message && message.config ? message.config : {});

    const token = await getFeishuTenantAccessToken(config);
    return {
      tokenPreview: token ? `${token.slice(0, 8)}...` : ""
    };
  }

  async function clearCollectionCache() {
    await chrome.storage.local.set({ [COLLECTION_INDEX_KEY]: {} });
    await appendLog("info", "dedupe", "已清空去重缓存");
    return { cleared: true };
  }

  async function collectDirectly(config, repoUrl) {
    const missing = getMissingDirectFields(config);
    if (missing.length > 0) {
      throw new Error(`缺少配置：${missing.join("、")}`);
    }

    const mappingIssues = getFieldMappingIssues(config.fieldMapping);
    if (mappingIssues.length > 0) {
      throw new Error(`字段映射里有重复列名：${mappingIssues.join("、")}`);
    }

    const repo = parseGitHubRepoUrl(repoUrl);
    if (!repo) {
      throw new Error("无法识别 GitHub 仓库地址");
    }

    await appendLog("info", "github", `读取仓库：${repo.owner}/${repo.repo}`);
    const repoData = await fetchGitHubRepo(repo.owner, repo.repo, config.githubToken);
    repoData.topics =
      Array.isArray(repoData.topics) && repoData.topics.length > 0
        ? repoData.topics
        : await fetchGitHubTopics(repo.owner, repo.repo, config.githubToken);

    const readme = await fetchGitHubReadme(repo.owner, repo.repo, config.githubToken);
    await appendLog("info", "model", `开始调用模型接口：${buildModelRequestUrl(config)}`);
    const aiData = await buildAiMetadata(repoData, readme, config);
    const fieldMapping = normalizeFieldMapping(config.fieldMapping);
    const fields = buildFeishuFields(repoData, aiData, fieldMapping);
    const dedupeProfile = buildDedupeProfile(repoData, fields, fieldMapping);

    await appendLog("info", "dedupe", `本次去重标识：${dedupeProfile.primaryLabel}`);

    await appendLog("info", "feishu", "开始写入飞书多维表格");
    const createdRecord = await createFeishuRecord(config, fields, dedupeProfile, fieldMapping);

    await appendLog(
      "info",
      "done",
      createdRecord.skippedDuplicate ? `已跳过重复记录：${repoData.full_name}` : `写入成功：${repoData.full_name}`
    );

    await saveRecentCollectResult({
      repo: repoData.full_name,
      url: repoData.html_url,
      category: aiData.category,
      aiUsed: aiData.aiUsed,
      aiMessage: aiData.aiMessage || "",
      skippedDuplicate: Boolean(createdRecord.skippedDuplicate),
      duplicateReason: createdRecord.duplicateReason || "",
      collectedAt: new Date().toISOString()
    });

    return {
      repo: repoData.full_name,
      category: aiData.category,
      recordId: createdRecord.record && createdRecord.record.record_id,
      aiUsed: aiData.aiUsed,
      aiMessage: aiData.aiMessage || "",
      skippedDuplicate: Boolean(createdRecord.skippedDuplicate),
      duplicateReason: createdRecord.duplicateReason || ""
    };
  }

  function getMissingDirectFields(config) {
    return [
      ["模型接口地址", config.openaiBaseUrl],
      ["模型 API Key", config.openaiApiKey],
      ["模型名称", config.openaiModel],
      ["飞书 App ID", config.feishuAppId],
      ["飞书 App Secret", config.feishuAppSecret],
      ["飞书多维表格 App Token", config.feishuBitableAppToken],
      ["飞书数据表 Table ID", config.feishuTableId]
    ]
      .filter((item) => !item[1])
      .map((item) => item[0]);
  }

  function normalizeApiBaseUrl(value) {
    const input = String(value || "").trim();
    if (!input) {
      return "";
    }

    try {
      const url = new URL(input);
      return url.origin + url.pathname.replace(/\/+$/, "");
    } catch {
      return "";
    }
  }

  function parseGitHubRepoUrl(input) {
    if (!input) {
      return null;
    }

    let url;
    try {
      url = new URL(input);
    } catch {
      return null;
    }

    const hostname = url.hostname.toLowerCase();
    if (hostname !== "github.com" && hostname !== "www.github.com") {
      return null;
    }

    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.length < 2) {
      return null;
    }

    const owner = segments[0];
    const repo = segments[1].replace(/\.git$/i, "");
    if (!owner || !repo || RESERVED_PATHS.has(owner.toLowerCase())) {
      return null;
    }

    return {
      owner,
      repo,
      url: `https://github.com/${owner}/${repo}`
    };
  }

  function buildGitHubHeaders(token) {
    const headers = {
      Accept: "application/vnd.github+json",
      "User-Agent": "github-feishu-collector-extension",
      "X-GitHub-Api-Version": "2022-11-28"
    };

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    return headers;
  }

  async function fetchGitHubRepo(owner, repo, token) {
    const response = await fetchWithTimeout(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: buildGitHubHeaders(token)
    });

    const data = await safeReadJson(response);
    if (!response.ok) {
      throw new Error(data.message || `读取 GitHub 仓库失败：HTTP ${response.status}`);
    }

    return data;
  }

  async function fetchGitHubTopics(owner, repo, token) {
    const response = await fetchWithTimeout(`https://api.github.com/repos/${owner}/${repo}/topics`, {
      headers: buildGitHubHeaders(token)
    });

    const data = await safeReadJson(response);
    if (!response.ok) {
      return [];
    }

    return Array.isArray(data.names) ? data.names : [];
  }

  async function fetchGitHubReadme(owner, repo, token) {
    const response = await fetchWithTimeout(`https://api.github.com/repos/${owner}/${repo}/readme`, {
      headers: {
        ...buildGitHubHeaders(token),
        Accept: "application/vnd.github.raw+json"
      }
    });

    if (!response.ok) {
      return "";
    }

    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const data = await safeReadJson(response);
      if (typeof data.content === "string") {
        return decodeBase64Utf8(data.content);
      }
      return "";
    }

    return response.text();
  }

  function decodeBase64Utf8(base64) {
    const binary = atob(String(base64 || "").replace(/\s+/g, ""));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  async function buildAiMetadata(repoData, readme, config) {
    const fallback = buildFallbackMetadata(repoData, readme);

    const userPrompt = JSON.stringify(
      {
        categoryOptions: CATEGORY_OPTIONS,
        task: {
          summary:
            "生成一个简体中文简介，控制在 150 到 220 个字，尽量两到三句。先说明项目核心能力，再补充适用场景、亮点、适合谁使用或为什么值得收藏，内容要具体，不要空话，也不要写成广告文案。",
          category: "从 categoryOptions 中挑一个最合适的分类。",
          tags: "给出 3 到 5 个短标签，优先使用通用技术词。"
        },
        repo: {
          name: repoData.name,
          full_name: repoData.full_name,
          description: repoData.description || "",
          language: repoData.language || "",
          topics: Array.isArray(repoData.topics) ? repoData.topics : [],
          homepage: repoData.homepage || "",
          stars: repoData.stargazers_count || 0,
          forks: repoData.forks_count || 0,
          readme_excerpt: trimText(readme, 6000)
        },
        outputSchema: {
          summary: "string",
          category: "string",
          tags: ["string"]
        }
      },
      null,
      2
    );

    try {
      const result = await callModelJson(config, {
        systemPrompt:
          "你是一个 GitHub 项目整理助手。你需要把仓库信息整理成适合录入知识库的结构化 JSON。只返回 JSON，不要输出解释。",
        userPrompt
      });

      const summary = normalizeProjectSummary(result.summary, fallback.summary, repoData);
      const category = CATEGORY_OPTIONS.includes(result.category)
        ? result.category
        : fallback.category;
      const tags = normalizeTags(result.tags, repoData.topics);

      await appendLog("info", "model", `AI 调用成功，模型：${config.openaiModel}`);
      return {
        summary,
        category,
        tags,
        aiUsed: true,
        aiMessage: `AI 已调用：${config.openaiModel}`
      };
    } catch (error) {
      await appendLog("warn", "model", `AI 调用失败，已回退：${toMessage(error)}`);
      return {
        ...fallback,
        aiUsed: false,
        aiMessage: `AI 调用失败，已回退：${toMessage(error)}`
      };
    }
  }

  async function callModelJson(config, prompts) {
    const requestUrl = buildModelRequestUrl(config);
    const headers = {
      Authorization: `Bearer ${config.openaiApiKey}`,
      "Content-Type": "application/json"
    };

    const payload = {
      model: config.openaiModel,
      temperature: 0.2,
      messages: [
        { role: "system", content: prompts.systemPrompt },
        { role: "user", content: prompts.userPrompt }
      ]
    };

    let response = await fetchWithTimeout(requestUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        ...payload,
        response_format: { type: "json_object" }
      })
    });

    if (!response.ok && response.status === 400) {
      response = await fetchWithTimeout(requestUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(payload)
      });
    }

    const data = await safeReadJson(response);
    if (!response.ok) {
      throw new Error(
        data.error && data.error.message ? data.error.message : `模型 API 调用失败：HTTP ${response.status}`
      );
    }

    const content = extractModelTextOutput(data);
    if (!content) {
      throw new Error("模型 API 未返回可解析内容");
    }

    return parsePossiblyWrappedJson(content);
  }

  function buildModelRequestUrl(config) {
    const apiBaseUrl = normalizeApiBaseUrl(config.openaiBaseUrl);
    if (!apiBaseUrl) {
      throw new Error("模型接口地址无效");
    }

    if (/\/responses(?:\/compact)?$/i.test(apiBaseUrl)) {
      throw new Error("当前版本只支持 OpenAI 兼容的 chat/completions，请填写 /v1 根地址或 /chat/completions 完整地址。");
    }

    if (/\/chat\/completions$/i.test(apiBaseUrl)) {
      return apiBaseUrl;
    }

    return `${apiBaseUrl}/chat/completions`;
  }

  function extractModelTextOutput(data) {
    const chatText =
      data &&
      data.choices &&
      data.choices[0] &&
      data.choices[0].message &&
      data.choices[0].message.content;

    if (typeof chatText === "string" && chatText.trim()) {
      return chatText;
    }

    if (typeof data.output_text === "string" && data.output_text.trim()) {
      return data.output_text;
    }

    const output = Array.isArray(data.output) ? data.output : [];
    for (const item of output) {
      const content = Array.isArray(item && item.content) ? item.content : [];
      for (const part of content) {
        if (part && typeof part.text === "string" && part.text.trim()) {
          return part.text;
        }
      }
    }

    return "";
  }

  function parsePossiblyWrappedJson(text) {
    try {
      return JSON.parse(text);
    } catch {
      const match = String(text).match(/\{[\s\S]*\}/);
      if (match) {
        return JSON.parse(match[0]);
      }
      throw new Error("模型输出不是合法 JSON");
    }
  }

  function buildFallbackMetadata(repoData, readme) {
    const description = cleanSingleLine(repoData.description || "");
    const paragraph = cleanSingleLine(extractFirstMeaningfulParagraph(readme));
    const summary = normalizeProjectSummary(
      [description, paragraph].filter(Boolean).join(" "),
      description || paragraph || `${repoData.name} 是一个值得关注的 GitHub 项目`,
      repoData
    );

    return {
      summary,
      category: inferCategory(repoData, readme),
      tags: normalizeTags(repoData.topics, [repoData.language].filter(Boolean))
    };
  }

  function inferCategory(repoData, readme) {
    const haystack = [
      repoData.name,
      repoData.description,
      repoData.language,
      ...(repoData.topics || []),
      trimText(readme, 3000)
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    if (hasAny(haystack, ["llm", "gpt", "rag", "prompt", "langchain", "openai"])) {
      return "AI/LLM";
    }
    if (hasAny(haystack, ["agent", "workflow", "n8n", "automation"])) {
      return "Agent/工作流";
    }
    if (hasAny(haystack, ["react", "vue", "next.js", "nextjs", "tailwind", "svelte", "ui"])) {
      return "前端/UI";
    }
    if (hasAny(haystack, ["api", "backend", "server", "fastapi", "express", "nestjs", "spring"])) {
      return "后端/API";
    }
    if (hasAny(haystack, ["docker", "kubernetes", "terraform", "ansible", "devops", "ci/cd"])) {
      return "DevOps/运维";
    }
    if (hasAny(haystack, ["pytorch", "tensorflow", "pandas", "numpy", "scikit", "machine learning"])) {
      return "数据科学/机器学习";
    }
    if (hasAny(haystack, ["crawler", "scraper", "spider", "playwright", "selenium"])) {
      return "爬虫/采集";
    }
    if (hasAny(haystack, ["productivity", "automation", "tools", "toolkit"])) {
      return "自动化/效率";
    }
    if (hasAny(haystack, ["ios", "android", "flutter", "react native", "swift"])) {
      return "移动端";
    }
    if (hasAny(haystack, ["security", "auth", "oauth", "jwt", "vulnerability", "ctf"])) {
      return "安全";
    }
    if (hasAny(haystack, ["database", "sql", "postgres", "mysql", "redis", "sqlite"])) {
      return "数据库";
    }
    if (hasAny(haystack, ["education", "course", "tutorial", "learning"])) {
      return "教育";
    }

    return "其他";
  }

  function hasAny(text, keywords) {
    return keywords.some((keyword) => text.includes(keyword));
  }

  function normalizeTags(primary, fallback) {
    return Array.from(
      new Set(
        [...toArray(primary), ...toArray(fallback)]
          .map((item) => String(item).trim())
          .filter(Boolean)
      )
    ).slice(0, 5);
  }

  function toArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function extractFirstMeaningfulParagraph(text) {
    return (
      String(text || "")
        .split(/\n{2,}/)
        .map((part) => part.replace(/[#>*`-]/g, " ").replace(/\s+/g, " ").trim())
        .find((part) => part.length >= 20) || ""
    );
  }

  function trimText(text, maxLength) {
    const normalized = String(text || "").replace(/\s+/g, " ").trim();
    if (normalized.length <= maxLength) {
      return normalized;
    }
    return `${normalized.slice(0, Math.max(maxLength - 3, 0))}...`;
  }

  function cleanSingleLine(text) {
    return String(text || "")
      .replace(/\s+/g, " ")
      .replace(/^["'`]+|["'`]+$/g, "")
      .trim();
  }

  function normalizeProjectSummary(candidate, fallback, repoData) {
    const cleanedCandidate = cleanSingleLine(candidate);
    const pieces = [
      cleanedCandidate,
      cleanSingleLine(fallback),
      buildRepoTechSentence(repoData),
      buildRepoAudienceSentence(repoData),
      buildRepoSignalSentence(repoData)
    ].filter(Boolean);

    const sentences = [];
    const seen = new Set();

    pieces.forEach((piece) => {
      splitSummarySentences(piece).forEach((sentence) => {
        const normalized = normalizeLooseText(sentence);
        if (!normalized || seen.has(normalized)) {
          return;
        }
        seen.add(normalized);
        sentences.push(sentence);
      });
    });

    let summary = cleanSingleLine(sentences.join(" "));
    if (summary.length < 140) {
      summary = cleanSingleLine(
        [
          summary,
          "适合在做同类工具选型、整理灵感、学习源码或寻找现成实现时作为参考。"
        ].join(" ")
      );
    }

    return trimText(summary, 220);
  }

  function normalizeLooseText(value) {
    return cleanSingleLine(value).toLowerCase();
  }

  function splitSummarySentences(text) {
    return String(text || "")
      .replace(/\s+/g, " ")
      .split(/(?<=[。！？.!?])/)
      .map((item) => cleanSingleLine(item))
      .filter(Boolean);
  }

  function buildRepoTechSentence(repoData) {
    const parts = [];

    if (repoData && repoData.language) {
      parts.push(`项目主要基于 ${repoData.language} 构建`);
    }

    if (repoData && Array.isArray(repoData.topics) && repoData.topics.length > 0) {
      parts.push(`覆盖 ${repoData.topics.slice(0, 3).join("、")} 等方向`);
    }

    if (parts.length === 0) {
      return "";
    }

    return `${parts.join("，")}。`;
  }

  function buildRepoAudienceSentence(repoData) {
    if (!repoData) {
      return "";
    }

    const description = cleanSingleLine(repoData.description || "");
    if (description && description.length >= 36) {
      return "如果你正在找同类方案、想整理灵感库，或者想快速判断这个项目值不值得深入看，这个仓库会比较有参考价值。";
    }

    return "更适合想找同类方案、做项目收藏、快速理解能力边界的开发者或内容整理用户。";
  }

  function buildRepoSignalSentence(repoData) {
    if (!repoData) {
      return "";
    }

    const stars = Number(repoData.stargazers_count || 0);
    const forks = Number(repoData.forks_count || 0);
    const starText = stars > 0 ? `当前约有 ${stars} 个星标` : "";
    const forkText = forks > 0 ? `和 ${forks} 个 Fork` : "";

    if (!starText && !forkText) {
      return "";
    }

    return `${starText}${forkText}，也能帮助你大致判断它在 GitHub 上的关注度。`;
  }

  function buildDedupeProfile(repoData, fields, fieldMapping) {
    const mapping = normalizeFieldMapping(fieldMapping);
    const repoIdentities = new Set([
      ...extractGitHubRepoIdentities(fields[mapping.link]),
      ...extractGitHubRepoIdentities(fields[mapping.repo]),
      ...extractGitHubRepoIdentities(repoData && repoData.full_name),
      ...extractGitHubRepoIdentities(repoData && repoData.html_url)
    ]);
    const exactLinks = new Set(
      [fields[mapping.link], repoData && repoData.html_url]
        .map((item) => normalizeLooseText(item))
        .filter(Boolean)
    );
    const title = normalizeLooseText(fields[mapping.title] || (repoData && repoData.name));
    const author = normalizeLooseText(
      fields[mapping.author] || (repoData && repoData.owner && repoData.owner.login)
    );
    const pairKey = title && author ? `pair:${author}/${title}` : "";
    const repoIdKey = repoData && repoData.id ? `repoid:${repoData.id}` : "";
    const cacheKeys = Array.from(new Set([repoIdKey, pairKey, ...repoIdentities].filter(Boolean)));
    const primaryIdentity = [...repoIdentities][0] || pairKey || repoIdKey || "";

    return {
      repoIdentities,
      exactLinks,
      title,
      author,
      pairKey,
      repoIdKey,
      cacheKeys,
      primaryIdentity,
      primaryLabel:
        primaryIdentity ||
        (title && author ? `${author}/${title}` : "") ||
        cleanSingleLine((repoData && repoData.full_name) || fields[mapping.link] || "-")
    };
  }

  function buildFeishuFields(repoData, aiData, fieldMapping) {
    const mapping = normalizeFieldMapping(fieldMapping);
    return {
      [mapping.title]: repoData.name,
      [mapping.link]: repoData.html_url,
      [mapping.summary]: aiData.summary,
      [mapping.category]: aiData.category,
      [mapping.stars]: Number(repoData.stargazers_count || 0),
      [mapping.forks]: Number(repoData.forks_count || 0),
      [mapping.language]: repoData.language || "",
      [mapping.topics]: aiData.tags.join(", "),
      [mapping.author]: (repoData.owner && repoData.owner.login) || "",
      [mapping.repo]: repoData.full_name,
      [mapping.homepage]: repoData.homepage || "",
      [mapping.updatedAt]: formatDateTime(repoData.pushed_at),
      [mapping.source]: "GitHub"
    };
  }

  function formatDateTime(value) {
    if (!value) {
      return "";
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return String(value);
    }

    return new Intl.DateTimeFormat("zh-CN", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Shanghai"
    }).format(date);
  }

  async function getFeishuTenantAccessToken(config) {
    await appendLog("info", "feishu", "获取 tenant_access_token");
    const response = await fetchWithTimeout(
      "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          app_id: config.feishuAppId,
          app_secret: config.feishuAppSecret
        })
      }
    );

    const data = await safeReadJson(response);
    if (!response.ok || data.code !== 0 || !data.tenant_access_token) {
      throw new Error(data.msg || `获取 tenant_access_token 失败：HTTP ${response.status}`);
    }

    return data.tenant_access_token;
  }

  async function createFeishuRecord(config, fields, dedupeProfile, fieldMapping) {
    const tenantAccessToken = await getFeishuTenantAccessToken(config);
    const tableKey = getCollectionTableKey(config);
    const targetIdentity = dedupeProfile.primaryIdentity;
    const fingerprint = dedupeProfile.primaryIdentity || dedupeProfile.pairKey || dedupeProfile.repoIdKey || "";
    await appendLog(
      "info",
      "dedupe",
      targetIdentity ? `开始去重检查：${targetIdentity}` : "开始去重检查：未提取到标准仓库标识"
    );

    if (dedupeProfile.cacheKeys.length > 0) {
      const cacheHit = await getCollectionCacheHit(tableKey, dedupeProfile.cacheKeys);
      if (cacheHit) {
        await appendLog("info", "dedupe", `本地缓存命中：${cacheHit.identity}`);
        return {
          record: {
            record_id: cacheHit.recordId || ""
          },
          skippedDuplicate: true,
          duplicateReason: `本地缓存：${cacheHit.identity}`
        };
      }
      await appendLog(
        "info",
        "dedupe",
        `本地缓存未命中：${targetIdentity || dedupeProfile.cacheKeys.slice(0, 2).join(" / ")}`
      );
    }

    const duplicateMatch = await findExistingFeishuRecord(
      config,
      tenantAccessToken,
      dedupeProfile,
      fieldMapping
    );
    if (duplicateMatch) {
      if (dedupeProfile.cacheKeys.length > 0) {
        await upsertCollectionCache(
          tableKey,
          dedupeProfile.cacheKeys,
          duplicateMatch.record.record_id || duplicateMatch.record.recordId || "",
          fingerprint
        );
      }
      await appendLog("info", "dedupe", `飞书记录命中：${duplicateMatch.identity || "重复项"}`);
      return {
        record: duplicateMatch.record,
        skippedDuplicate: true,
        duplicateReason: duplicateMatch.identity ? `飞书匹配：${duplicateMatch.identity}` : "飞书匹配"
      };
    }

    await appendLog("info", "dedupe", "飞书记录未命中，继续创建新记录");

    const normalizedFields = await normalizeFieldsForFeishu(config, tenantAccessToken, fields);
    const response = await fetchWithTimeout(
      `https://open.feishu.cn/open-apis/bitable/v1/apps/${config.feishuBitableAppToken}/tables/${config.feishuTableId}/records`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tenantAccessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ fields: normalizedFields })
      }
    );

    const data = await safeReadJson(response);
    if (!response.ok || data.code !== 0) {
      throw new Error(
        `${data.msg || `写入飞书多维表格失败：HTTP ${response.status}`}${data.code ? ` (code: ${data.code})` : ""}`
      );
    }

    const created = data.data || {};
    if (dedupeProfile.cacheKeys.length > 0) {
      await upsertCollectionCache(
        tableKey,
        dedupeProfile.cacheKeys,
        created.record && created.record.record_id ? created.record.record_id : "",
        fingerprint
      );
    }

    return created;
  }

  async function findExistingFeishuRecord(config, tenantAccessToken, dedupeProfile, fieldMapping) {
    const mapping = normalizeFieldMapping(fieldMapping);
    const targetIdentities = dedupeProfile.repoIdentities;
    const targetLinks = dedupeProfile.exactLinks;
    const targetTitle = dedupeProfile.title;
    const targetAuthor = dedupeProfile.author;

    if (targetIdentities.size === 0 && targetLinks.size === 0) {
      if (!targetTitle || !targetAuthor) {
        return null;
      }
    }

    await appendLog(
      "info",
      "dedupe",
      `开始扫描飞书记录：${targetIdentities.size > 0 ? [...targetIdentities].join(", ") : targetLinks.size > 0 ? [...targetLinks].join(", ") : `${targetAuthor}/${targetTitle}`}`
    );

    let pageToken = "";

    while (true) {
      const search = new URLSearchParams({ page_size: "500" });
      if (pageToken) {
        search.set("page_token", pageToken);
      }

      const response = await fetchWithTimeout(
        `https://open.feishu.cn/open-apis/bitable/v1/apps/${config.feishuBitableAppToken}/tables/${config.feishuTableId}/records?${search.toString()}`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${tenantAccessToken}`,
            "Content-Type": "application/json"
          }
        }
      );

      const data = await safeReadJson(response);
      if (!response.ok || data.code !== 0) {
        throw new Error(data.msg || `读取飞书记录失败：HTTP ${response.status}`);
      }

      const items = data.data && Array.isArray(data.data.items) ? data.data.items : [];
      for (const item of items) {
        const itemFields = item && item.fields ? item.fields : {};
        const itemLinks = new Set(
          extractComparableStrings(itemFields[mapping.link], 0)
            .map((entry) => normalizeLooseText(entry))
            .filter(Boolean)
        );
        const itemIdentities = new Set([
          ...extractGitHubRepoIdentities(itemFields[mapping.link]),
          ...extractGitHubRepoIdentities(itemFields[mapping.repo]),
          ...extractGitHubRepoIdentities(itemFields),
          ...extractGitHubRepoIdentities(item)
        ]);

        const matchedLink = [...itemLinks].find((link) => targetLinks.has(link));
        if (matchedLink) {
          return {
            record: item,
            identity: matchedLink
          };
        }

        const matchedIdentity = [...itemIdentities].find((identity) => targetIdentities.has(identity));
        if (matchedIdentity) {
          return {
            record: item,
            identity: matchedIdentity
          };
        }

        const itemTitle = normalizeLooseText(itemFields[mapping.title]);
        const itemAuthor = normalizeLooseText(itemFields[mapping.author]);
        if (targetTitle && targetAuthor && itemTitle === targetTitle && itemAuthor === targetAuthor) {
          return {
            record: item,
            identity: `${itemAuthor}/${itemTitle}`
          };
        }
      }

      if (!data.data || !data.data.has_more || !data.data.page_token) {
        return null;
      }

      pageToken = data.data.page_token;
    }
  }

  async function normalizeFieldsForFeishu(config, tenantAccessToken, fields) {
    try {
      const fieldTypeMap = await listFeishuFieldTypes(config, tenantAccessToken);
      const normalized = {};

      for (const [fieldName, value] of Object.entries(fields)) {
        normalized[fieldName] = normalizeFeishuFieldValue(value, fieldTypeMap[fieldName]);
      }

      await appendLog("info", "feishu", `字段类型已识别：${Object.keys(fieldTypeMap).length} 个字段`);
      return normalized;
    } catch (error) {
      await appendLog("warn", "feishu", `读取字段类型失败，回退到保守模式：${toMessage(error)}`);
      return Object.fromEntries(
        Object.entries(fields).map(([fieldName, value]) => [
          fieldName,
          typeof value === "number" ? String(value) : value
        ])
      );
    }
  }

  async function listFeishuFieldTypes(config, tenantAccessToken) {
    const response = await fetchWithTimeout(
      `https://open.feishu.cn/open-apis/bitable/v1/apps/${config.feishuBitableAppToken}/tables/${config.feishuTableId}/fields?page_size=500`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${tenantAccessToken}`,
          "Content-Type": "application/json"
        }
      }
    );

    const data = await safeReadJson(response);
    if (!response.ok || data.code !== 0) {
      throw new Error(data.msg || `读取飞书字段失败：HTTP ${response.status}`);
    }

    const items = data.data && Array.isArray(data.data.items) ? data.data.items : [];
    const fieldTypeMap = {};

    for (const item of items) {
      if (item && item.field_name) {
        fieldTypeMap[item.field_name] = item.type;
      }
    }

    return fieldTypeMap;
  }

  function normalizeFeishuFieldValue(value, fieldType) {
    if (value === null || value === undefined) {
      return "";
    }

    if (fieldType === FEISHU_FIELD_TYPE_NUMBER) {
      const parsed = typeof value === "number" ? value : Number(value);
      return Number.isFinite(parsed) ? parsed : 0;
    }

    if (Array.isArray(value)) {
      return value.join(", ");
    }

    return typeof value === "string" ? value : String(value);
  }

  function getCollectionTableKey(config) {
    return `${String(config.feishuBitableAppToken || "").trim()}::${String(config.feishuTableId || "").trim()}`;
  }

  async function getCollectionCacheHit(tableKey, identities) {
    const identityList = Array.isArray(identities) ? identities.filter(Boolean) : [identities].filter(Boolean);
    if (!tableKey || identityList.length === 0) {
      return null;
    }

    const stored = await chrome.storage.local.get({ [COLLECTION_INDEX_KEY]: {} });
    const index = isPlainObject(stored[COLLECTION_INDEX_KEY]) ? stored[COLLECTION_INDEX_KEY] : {};
    const tableCache = isPlainObject(index[tableKey]) ? index[tableKey] : {};
    const globalCache = isPlainObject(index[GLOBAL_COLLECTION_TABLE_KEY]) ? index[GLOBAL_COLLECTION_TABLE_KEY] : {};

    for (const identity of identityList) {
      if (tableCache[identity]) {
        return {
          ...tableCache[identity],
          identity
        };
      }

      const globalEntry = globalCache[identity];
      if (globalEntry && (!globalEntry.tableKey || globalEntry.tableKey === tableKey)) {
        return {
          ...globalEntry,
          identity
        };
      }
    }

    return null;
  }

  async function upsertCollectionCache(tableKey, identities, recordId, fingerprint) {
    const identityList = Array.isArray(identities) ? identities.filter(Boolean) : [identities].filter(Boolean);
    if (!tableKey || identityList.length === 0) {
      return;
    }

    const stored = await chrome.storage.local.get({ [COLLECTION_INDEX_KEY]: {} });
    const index = isPlainObject(stored[COLLECTION_INDEX_KEY]) ? stored[COLLECTION_INDEX_KEY] : {};
    const tableCache = isPlainObject(index[tableKey]) ? index[tableKey] : {};
    const globalCache = isPlainObject(index[GLOBAL_COLLECTION_TABLE_KEY]) ? index[GLOBAL_COLLECTION_TABLE_KEY] : {};
    const touchedAt = Date.now();
    const nextFingerprint = fingerprint || identityList[0];

    identityList.forEach((identity) => {
      tableCache[identity] = {
        recordId: recordId || "",
        touchedAt,
        fingerprint: nextFingerprint,
        tableKey
      };
      globalCache[identity] = {
        recordId: recordId || "",
        touchedAt,
        fingerprint: nextFingerprint,
        tableKey
      };
    });

    index[tableKey] = pruneCollectionCache(tableCache);
    index[GLOBAL_COLLECTION_TABLE_KEY] = pruneCollectionCache(globalCache);
    await chrome.storage.local.set({ [COLLECTION_INDEX_KEY]: index });
  }

  function pruneCollectionCache(cache) {
    return Object.fromEntries(
      Object.entries(cache)
        .sort((a, b) => {
          const timeA = a[1] && a[1].touchedAt ? a[1].touchedAt : 0;
          const timeB = b[1] && b[1].touchedAt ? b[1].touchedAt : 0;
          return timeB - timeA;
        })
        .slice(0, MAX_COLLECTION_CACHE)
    );
  }

  function extractGitHubRepoIdentities(value) {
    const identities = new Set();

    for (const candidate of extractComparableStrings(value, 0)) {
      const normalized = normalizeGitHubRepoIdentity(candidate);
      if (normalized) {
        identities.add(normalized);
      }
    }

    return [...identities];
  }

  function extractComparableStrings(value, depth) {
    if (value === null || value === undefined || depth > 5) {
      return [];
    }

    if (typeof value === "string") {
      return [value];
    }

    if (typeof value === "number" || typeof value === "boolean") {
      return [String(value)];
    }

    if (Array.isArray(value)) {
      return Array.from(
        new Set(
          value.flatMap((item) => extractComparableStrings(item, depth + 1)).filter(Boolean)
        )
      );
    }

    if (!isPlainObject(value)) {
      return [];
    }

    const priorityKeys = ["text", "url", "link", "href", "name", "value", "title", "content"];
    const visited = new Set();
    const results = [];

    for (const key of priorityKeys) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        visited.add(key);
        results.push(...extractComparableStrings(value[key], depth + 1));
      }
    }

    for (const [key, nestedValue] of Object.entries(value)) {
      if (visited.has(key)) {
        continue;
      }
      results.push(...extractComparableStrings(nestedValue, depth + 1));
    }

    return Array.from(new Set(results.filter(Boolean)));
  }

  function normalizeGitHubRepoIdentity(value) {
    const raw = String(value || "").trim();
    if (!raw) {
      return "";
    }

    try {
      const url = new URL(raw);
      const hostname = url.hostname.toLowerCase();
      if (hostname === "github.com" || hostname === "www.github.com") {
        const segments = url.pathname.split("/").filter(Boolean);
        if (segments.length >= 2) {
          const owner = segments[0];
          const repo = segments[1].replace(/\.git$/i, "");
          if (!owner || !repo || RESERVED_PATHS.has(owner.toLowerCase())) {
            return "";
          }
          return `${owner.toLowerCase()}/${repo.toLowerCase()}`;
        }
      }
    } catch {
      // ignore invalid URL and continue with owner/repo matching
    }

    const match = raw.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/);
    if (!match) {
      return "";
    }

    const owner = match[1];
    const repo = match[2];
    if (!owner || !repo || RESERVED_PATHS.has(owner.toLowerCase())) {
      return "";
    }

    return `${owner.toLowerCase()}/${repo.toLowerCase()}`;
  }

  function isPlainObject(value) {
    return Object.prototype.toString.call(value) === "[object Object]";
  }

  async function safeReadJson(response) {
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      return response.json();
    }

    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch {
      return { message: text };
    }
  }

  async function fetchWithTimeout(url, options) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      return await fetch(url, {
        ...options,
        signal: controller.signal
      });
    } catch (error) {
      if (error && error.name === "AbortError") {
        throw new Error(`请求超时（${Math.round(REQUEST_TIMEOUT_MS / 1000)}s）：${url}`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async function appendLog(level, stage, message) {
    const entry = {
      time: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
      level,
      stage,
      message
    };

    try {
      const stored = await chrome.storage.local.get({ [LOG_STORAGE_KEY]: [] });
      const logs = Array.isArray(stored[LOG_STORAGE_KEY]) ? stored[LOG_STORAGE_KEY] : [];
      logs.push(entry);
      await chrome.storage.local.set({
        [LOG_STORAGE_KEY]: logs.slice(-MAX_LOGS)
      });
    } catch (error) {
      console.warn("appendLog failed", error);
    }
  }

  async function saveRecentCollectResult(result) {
    try {
      await chrome.storage.local.set({
        [RECENT_RESULT_KEY]: result
      });
    } catch (error) {
      console.warn("saveRecentCollectResult failed", error);
    }
  }

  function toMessage(error) {
    if (!error) {
      return "";
    }

    return error instanceof Error ? error.message : String(error);
  }

})();
