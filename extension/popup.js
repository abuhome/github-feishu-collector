(function () {
  "use strict";

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
    fieldMapping: { ...DEFAULT_FIELD_MAPPING }
  };

  const DEFAULT_SETUP_PROGRESS = {
    modelTestOk: false,
    modelTestAt: "",
    feishuTestOk: false,
    feishuTestAt: ""
  };

  const DEFAULT_GUIDE_UI = {
    forceOpen: false
  };

  const LOG_STORAGE_KEY = "runtimeLogs";
  const COLLECTION_INDEX_KEY = "collectionIndex";
  const RECENT_RESULT_KEY = "recentCollectResult";
  const SETUP_PROGRESS_KEY = "setupProgress";
  const GUIDE_UI_KEY = "guideUiState";
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

  const state = {
    activeTab: "collect",
    config: { ...DEFAULT_CONFIG },
    repoUrl: "",
    repoLabel: "",
    extensionVersion: "dev",
    recentResult: null,
    setupProgress: { ...DEFAULT_SETUP_PROGRESS },
    guideUi: { ...DEFAULT_GUIDE_UI },
    collectMotionTimer: 0
  };

  const elements = {};

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    bindElements();
    hydrateExtensionMeta();
    bindEvents();
    rememberDefaultButtonTexts();
    switchTab(state.activeTab);

    await loadConfig();
    await loadSetupProgress();
    await loadGuideUi();
    await loadRecentResult();
    await refreshCurrentTab();
    await refreshReadiness();
    await refreshCacheSummary();
    refreshRecentResultCard();
    refreshWizard();
    await loadLogs();

    if (chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener(handleStorageChanged);
    }
  }

  function bindElements() {
    elements.modeStatus = document.getElementById("modeStatus");
    elements.configStatus = document.getElementById("configStatus");
    elements.repoStatus = document.getElementById("repoStatus");
    elements.versionText = document.getElementById("versionText");
    elements.quickStartDesc = document.getElementById("quickStartDesc");
    elements.guideToggleBtn = document.getElementById("guideToggleBtn");
    elements.setupGuideCard = document.getElementById("setupGuideCard");
    elements.repoCardTitle = document.getElementById("repoCardTitle");
    elements.repoCardHint = document.getElementById("repoCardHint");
    elements.modelReadyText = document.getElementById("modelReadyText");
    elements.feishuReadyText = document.getElementById("feishuReadyText");
    elements.cacheSummaryText = document.getElementById("cacheSummaryText");
    elements.collectBtn = document.getElementById("collectBtn");
    elements.testModelBtn = document.getElementById("testModelBtn");
    elements.testFeishuBtn = document.getElementById("testFeishuBtn");
    elements.openaiBaseUrlInput = document.getElementById("openaiBaseUrlInput");
    elements.openaiApiKeyInput = document.getElementById("openaiApiKeyInput");
    elements.openaiModelInput = document.getElementById("openaiModelInput");
    elements.githubTokenInput = document.getElementById("githubTokenInput");
    elements.saveModelBtn = document.getElementById("saveModelBtn");
    elements.feishuAppIdInput = document.getElementById("feishuAppIdInput");
    elements.feishuAppSecretInput = document.getElementById("feishuAppSecretInput");
    elements.feishuAppTokenInput = document.getElementById("feishuAppTokenInput");
    elements.feishuTableIdInput = document.getElementById("feishuTableIdInput");
    elements.saveFeishuBtn = document.getElementById("saveFeishuBtn");
    elements.clearSecretsBtn = document.getElementById("clearSecretsBtn");
    elements.refreshLogsBtn = document.getElementById("refreshLogsBtn");
    elements.clearLogsBtn = document.getElementById("clearLogsBtn");
    elements.copyLogsBtn = document.getElementById("copyLogsBtn");
    elements.clearCacheBtn = document.getElementById("clearCacheBtn");
    elements.logOutput = document.getElementById("logOutput");
    elements.feedbackText = document.getElementById("feedbackText");
    elements.recentResultCard = document.getElementById("recentResultCard");
    elements.recentResultBadge = document.getElementById("recentResultBadge");
    elements.recentResultAi = document.getElementById("recentResultAi");
    elements.recentResultRepo = document.getElementById("recentResultRepo");
    elements.recentResultMeta = document.getElementById("recentResultMeta");
    elements.recentResultLink = document.getElementById("recentResultLink");
    elements.wizardModelState = document.getElementById("wizardModelState");
    elements.wizardFeishuState = document.getElementById("wizardFeishuState");
    elements.wizardTestState = document.getElementById("wizardTestState");
    elements.wizardCollectState = document.getElementById("wizardCollectState");
    elements.wizardToModelBtn = document.getElementById("wizardToModelBtn");
    elements.wizardToFeishuBtn = document.getElementById("wizardToFeishuBtn");
    elements.wizardTestModelBtn = document.getElementById("wizardTestModelBtn");
    elements.wizardTestFeishuBtn = document.getElementById("wizardTestFeishuBtn");
    elements.wizardCollectBtn = document.getElementById("wizardCollectBtn");
    elements.resetFieldMappingBtn = document.getElementById("resetFieldMappingBtn");
    elements.mappingInputs = Array.from(document.querySelectorAll("[data-mapping-key]"));
    elements.tabButtons = Array.from(document.querySelectorAll(".tabbar__item"));
    elements.tabPanels = Array.from(document.querySelectorAll(".tab-panel"));
  }

  function hydrateExtensionMeta() {
    const manifest = chrome.runtime.getManifest();
    state.extensionVersion = manifest && manifest.version ? manifest.version : "dev";

    if (elements.versionText) {
      elements.versionText.textContent = `v${state.extensionVersion}`;
    }

    if (elements.modeStatus) {
      elements.modeStatus.textContent = "纯扩展直连";
      elements.modeStatus.dataset.state = "online";
    }
  }

  function bindEvents() {
    elements.tabButtons.forEach((button) => {
      button.addEventListener("click", () => switchTab(button.dataset.tab || "collect"));
    });

    elements.collectBtn.addEventListener("click", handleCollect);
    elements.testModelBtn.addEventListener("click", testModelConnection);
    elements.testFeishuBtn.addEventListener("click", testFeishuConnection);
    elements.saveModelBtn.addEventListener("click", saveModelSettings);
    elements.saveFeishuBtn.addEventListener("click", saveFeishuSettings);
    elements.clearSecretsBtn.addEventListener("click", clearSecrets);
    elements.refreshLogsBtn.addEventListener("click", loadLogs);
    elements.clearLogsBtn.addEventListener("click", clearLogs);
    elements.copyLogsBtn.addEventListener("click", copyLogs);
    elements.clearCacheBtn.addEventListener("click", clearCollectionCache);
    elements.guideToggleBtn.addEventListener("click", toggleGuideCard);
    elements.resetFieldMappingBtn.addEventListener("click", resetFieldMapping);
    elements.wizardToModelBtn.addEventListener("click", () => {
      switchTab("model");
      setFeedback("请先完成模型配置，保存后再继续测试。", "neutral");
    });
    elements.wizardToFeishuBtn.addEventListener("click", () => {
      switchTab("feishu");
      setFeedback("请先完成飞书配置，保存后再继续测试。", "neutral");
    });
    elements.wizardTestModelBtn.addEventListener("click", testModelConnection);
    elements.wizardTestFeishuBtn.addEventListener("click", testFeishuConnection);
    elements.wizardCollectBtn.addEventListener("click", handleCollect);

    window.addEventListener("focus", async () => {
      await refreshCurrentTab();
      await refreshCacheSummary();
      await loadRecentResult();
      await loadLogs();
      refreshRecentResultCard();
      refreshWizard();
    });
  }

  function rememberDefaultButtonTexts() {
    [
      elements.collectBtn,
      elements.testModelBtn,
      elements.testFeishuBtn,
      elements.saveModelBtn,
      elements.saveFeishuBtn,
      elements.clearSecretsBtn,
      elements.refreshLogsBtn,
      elements.clearLogsBtn,
      elements.copyLogsBtn,
      elements.clearCacheBtn,
      elements.wizardToModelBtn,
      elements.wizardToFeishuBtn,
      elements.wizardTestModelBtn,
      elements.wizardTestFeishuBtn,
      elements.wizardCollectBtn
    ]
      .filter(Boolean)
      .forEach((button) => {
        button.dataset.defaultText = button.textContent;
      });
  }

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
    const seen = new Map();
    const duplicates = [];

    Object.entries(normalized).forEach(([key, value]) => {
      const identity = normalizeLooseText(value);
      if (!identity) {
        return;
      }
      if (seen.has(identity)) {
        duplicates.push([seen.get(identity), key, value]);
        return;
      }
      seen.set(identity, key);
    });

    return duplicates.map((entry) => entry[2]);
  }

  function fillFieldMapping(fieldMapping) {
    const normalized = normalizeFieldMapping(fieldMapping);
    elements.mappingInputs.forEach((input) => {
      const mappingKey = input.dataset.mappingKey || "";
      input.value = normalized[mappingKey] || "";
    });
  }

  function collectFieldMapping() {
    return normalizeFieldMapping(
      Object.fromEntries(
        elements.mappingInputs.map((input) => [input.dataset.mappingKey || "", input.value || ""])
      )
    );
  }

  async function loadConfig() {
    const stored = await chrome.storage.local.get(DEFAULT_CONFIG);
    state.config = mergeConfig(stored);
    fillForm(state.config);
  }

  async function loadSetupProgress() {
    const stored = await chrome.storage.local.get({ [SETUP_PROGRESS_KEY]: DEFAULT_SETUP_PROGRESS });
    state.setupProgress = {
      ...DEFAULT_SETUP_PROGRESS,
      ...(stored[SETUP_PROGRESS_KEY] || {})
    };
  }

  async function loadGuideUi() {
    const stored = await chrome.storage.local.get({ [GUIDE_UI_KEY]: DEFAULT_GUIDE_UI });
    state.guideUi = {
      ...DEFAULT_GUIDE_UI,
      ...(stored[GUIDE_UI_KEY] || {})
    };
  }

  async function loadRecentResult() {
    const stored = await chrome.storage.local.get({ [RECENT_RESULT_KEY]: null });
    state.recentResult = stored[RECENT_RESULT_KEY] || null;
  }

  function fillForm(config) {
    const mergedConfig = mergeConfig(config);
    elements.openaiBaseUrlInput.value = mergedConfig.openaiBaseUrl || "";
    elements.openaiApiKeyInput.value = mergedConfig.openaiApiKey || "";
    elements.openaiModelInput.value = mergedConfig.openaiModel || "";
    elements.githubTokenInput.value = mergedConfig.githubToken || "";
    elements.feishuAppIdInput.value = mergedConfig.feishuAppId || "";
    elements.feishuAppSecretInput.value = mergedConfig.feishuAppSecret || "";
    elements.feishuAppTokenInput.value = mergedConfig.feishuBitableAppToken || "";
    elements.feishuTableIdInput.value = mergedConfig.feishuTableId || "";
    fillFieldMapping(mergedConfig.fieldMapping);
  }

  function collectFormConfig() {
    return mergeConfig({
      githubToken: String(elements.githubTokenInput.value || "").trim(),
      modelApiMode: DEFAULT_CONFIG.modelApiMode,
      openaiBaseUrl:
        normalizeApiBaseUrl(elements.openaiBaseUrlInput.value) || DEFAULT_CONFIG.openaiBaseUrl,
      openaiApiKey: String(elements.openaiApiKeyInput.value || "").trim(),
      openaiModel: String(elements.openaiModelInput.value || "").trim() || DEFAULT_CONFIG.openaiModel,
      feishuAppId: String(elements.feishuAppIdInput.value || "").trim(),
      feishuAppSecret: String(elements.feishuAppSecretInput.value || "").trim(),
      feishuBitableAppToken: String(elements.feishuAppTokenInput.value || "").trim(),
      feishuTableId: String(elements.feishuTableIdInput.value || "").trim(),
      fieldMapping: collectFieldMapping()
    });
  }

  function switchTab(tabName) {
    state.activeTab = tabName;
    elements.tabButtons.forEach((button) => {
      button.classList.toggle("is-active", button.dataset.tab === tabName);
    });
    elements.tabPanels.forEach((panel) => {
      panel.classList.toggle("hidden", panel.dataset.panel !== tabName);
    });
  }

  async function refreshCurrentTab() {
    const [tab] = await chrome.tabs.query({
      active: true,
      lastFocusedWindow: true
    });

    const repo = parseGitHubRepoUrl(tab && tab.url);
    if (!repo) {
      state.repoUrl = "";
      state.repoLabel = "";
      elements.repoStatus.textContent = "当前页面不是 GitHub 仓库";
      elements.repoStatus.dataset.state = "warn";
      elements.repoCardTitle.textContent = "还没有识别到仓库";
      elements.repoCardHint.textContent = "请切到一个 GitHub 仓库主页，再回来采集。";
      elements.collectBtn.disabled = true;
      refreshWizard();
      return;
    }

    state.repoUrl = repo.url;
    state.repoLabel = `${repo.owner}/${repo.repo}`;
    elements.repoStatus.textContent = state.repoLabel;
    elements.repoStatus.dataset.state = "online";
    elements.repoCardTitle.textContent = state.repoLabel;
    elements.repoCardHint.textContent = "点击“保存当前项目”后，会直接读取 GitHub、调用模型并写入飞书。";
    elements.collectBtn.disabled = false;
    refreshWizard();
  }

  async function refreshReadiness() {
    const config = collectFormConfig();
    const modelMissing = getMissingModelFields(config);
    const feishuMissing = getMissingFeishuFields(config);
    const mappingIssues = getFieldMappingIssues(config.fieldMapping);

    elements.modelReadyText.textContent = modelMissing.length === 0 ? "已就绪" : `缺 ${modelMissing.length} 项`;
    elements.feishuReadyText.textContent =
      feishuMissing.length > 0
        ? `缺 ${feishuMissing.length} 项`
        : mappingIssues.length > 0
          ? "映射待处理"
          : "已就绪";

    if (modelMissing.length === 0 && feishuMissing.length === 0 && mappingIssues.length === 0) {
      elements.configStatus.textContent = "配置已就绪";
      elements.configStatus.dataset.state = "online";
      setFeedback("配置已经就绪，可以直接保存当前项目。", "success");
    } else {
      const missingCount = modelMissing.length + feishuMissing.length;
      elements.configStatus.textContent =
        mappingIssues.length > 0 && missingCount === 0
          ? "字段映射待处理"
          : `还缺 ${missingCount} 项配置`;
      elements.configStatus.dataset.state = "warn";
      setFeedback(
        mappingIssues.length > 0
          ? `字段映射里有重复列名：${mappingIssues.join("、")}。调整后再采集会更稳。`
          : "第一次使用时，先完成“模型”和“飞书”两页配置。",
        "warning"
      );
    }

    refreshWizard();
  }

  async function refreshCacheSummary() {
    const config = collectFormConfig();
    const storage = await chrome.storage.local.get({ [COLLECTION_INDEX_KEY]: {} });
    const index = isPlainObject(storage[COLLECTION_INDEX_KEY]) ? storage[COLLECTION_INDEX_KEY] : {};
    const tableKey = getCollectionTableKey(config);
    const tableCache = isPlainObject(index[tableKey]) ? index[tableKey] : {};
    const fingerprints = new Set();

    Object.entries(tableCache).forEach(([identity, entry]) => {
      if (isPlainObject(entry) && entry.fingerprint) {
        fingerprints.add(entry.fingerprint);
        return;
      }
      if (isPlainObject(entry) && entry.recordId) {
        fingerprints.add(entry.recordId);
        return;
      }
      fingerprints.add(identity);
    });

    elements.cacheSummaryText.textContent = `${fingerprints.size} 条`;
  }

  function refreshRecentResultCard() {
    const result = state.recentResult;
    if (!result || !elements.recentResultRepo || !elements.recentResultMeta) {
      elements.recentResultCard.classList.add("result-card--empty");
      elements.recentResultBadge.textContent = "等待采集";
      elements.recentResultBadge.className = "result-pill result-pill--neutral";
      elements.recentResultAi.textContent = "尚未生成";
      elements.recentResultAi.className = "result-pill result-pill--neutral";
      elements.recentResultRepo.textContent = "还没有采集记录";
      elements.recentResultMeta.textContent = "完成一次采集后，这里会显示最近一次写入或跳过重复的结果。";
      elements.recentResultLink.classList.add("hidden");
      elements.recentResultLink.removeAttribute("href");
      return;
    }

    elements.recentResultCard.classList.remove("result-card--empty");
    const statusText = result.skippedDuplicate ? "已跳过重复" : "已新建记录";
    const aiText = result.aiUsed ? "AI 已调用" : "AI 已回退";
    const timeText = result.collectedAt ? formatDateTime(result.collectedAt) : "刚刚";
    elements.recentResultBadge.textContent = statusText;
    elements.recentResultBadge.className = `result-pill ${result.skippedDuplicate ? "result-pill--warning" : "result-pill--success"}`;
    elements.recentResultAi.textContent = aiText;
    elements.recentResultAi.className = `result-pill ${result.aiUsed ? "result-pill--success" : "result-pill--neutral"}`;
    elements.recentResultRepo.textContent = result.repo || "未知仓库";
    elements.recentResultMeta.textContent =
      `结果：${statusText} · 分类：${result.category || "未分类"} · ${aiText} · ${timeText}`;
    if (result.url) {
      elements.recentResultLink.href = result.url;
      elements.recentResultLink.classList.remove("hidden");
    } else {
      elements.recentResultLink.classList.add("hidden");
      elements.recentResultLink.removeAttribute("href");
    }
  }

  function refreshWizard() {
    const config = collectFormConfig();
    const modelReady = getMissingModelFields(config).length === 0;
    const feishuReady = getMissingFeishuFields(config).length === 0;
    const mappingIssues = getFieldMappingIssues(config.fieldMapping);
    const testReady = Boolean(state.setupProgress.modelTestOk && state.setupProgress.feishuTestOk);
    const collectReady = Boolean(modelReady && feishuReady && mappingIssues.length === 0);
    const guideCompleted = Boolean(collectReady && testReady);
    const currentRepoIdentity = normalizeRepoIdentity(state.repoLabel);
    const recentRepoIdentity = normalizeRepoIdentity(state.recentResult && state.recentResult.repo);
    const collectedCurrentRepo = Boolean(currentRepoIdentity && currentRepoIdentity === recentRepoIdentity);

    setWizardState(elements.wizardModelState, modelReady ? "已完成" : "待完成", modelReady ? "done" : "idle");
    setWizardState(
      elements.wizardFeishuState,
      feishuReady ? (mappingIssues.length > 0 ? "映射待处理" : "已完成") : "待完成",
      feishuReady && mappingIssues.length === 0 ? "done" : feishuReady ? "warn" : "idle"
    );

    if (testReady) {
      setWizardState(elements.wizardTestState, "已完成", "done");
    } else if (state.setupProgress.modelTestOk || state.setupProgress.feishuTestOk) {
      setWizardState(elements.wizardTestState, "进行中", "warn");
    } else {
      setWizardState(elements.wizardTestState, "未测试", "idle");
    }

    if (collectedCurrentRepo) {
      setWizardState(
        elements.wizardCollectState,
        state.recentResult && state.recentResult.skippedDuplicate ? "已跳过重复" : "已完成",
        "done"
      );
    } else if (!state.repoUrl) {
      setWizardState(elements.wizardCollectState, "先打开仓库", "warn");
    } else if (collectReady) {
      setWizardState(elements.wizardCollectState, "可执行", "warn");
    } else {
      setWizardState(elements.wizardCollectState, "待执行", "idle");
    }

    elements.wizardTestModelBtn.disabled = !modelReady;
    elements.wizardTestFeishuBtn.disabled = !feishuReady;
    elements.wizardCollectBtn.disabled = !state.repoUrl || !collectReady;

    refreshGuideCard(guideCompleted);
  }

  function refreshGuideCard(guideCompleted) {
    const shouldHide = guideCompleted && !state.guideUi.forceOpen;

    if (elements.setupGuideCard) {
      elements.setupGuideCard.classList.toggle("hidden", shouldHide);
    }

    if (elements.guideToggleBtn) {
      elements.guideToggleBtn.textContent = guideCompleted
        ? shouldHide
          ? "查看引导"
          : "收起引导"
        : "引导进行中";
      elements.guideToggleBtn.disabled = !guideCompleted;
    }

    if (elements.quickStartDesc) {
      elements.quickStartDesc.textContent = guideCompleted
        ? shouldHide
          ? "基础配置与测试已完成，可直接采集；需要时可展开完整引导。"
          : "基础配置与测试已完成，当前展示的是完整引导，便于复查配置。"
        : "建议先完成基础配置与测试，再开始采集。";
    }
  }

  async function toggleGuideCard() {
    const config = collectFormConfig();
    const guideCompleted =
      getMissingModelFields(config).length === 0 &&
      getMissingFeishuFields(config).length === 0 &&
      getFieldMappingIssues(config.fieldMapping).length === 0 &&
      state.setupProgress.modelTestOk &&
      state.setupProgress.feishuTestOk;

    if (!guideCompleted) {
      setFeedback("引导会在基础配置与测试完成前保持展开，便于按步骤操作。", "neutral");
      return;
    }

    state.guideUi = {
      ...state.guideUi,
      forceOpen: !state.guideUi.forceOpen
    };

    await chrome.storage.local.set({
      [GUIDE_UI_KEY]: state.guideUi
    });

    refreshWizard();
  }

  function setWizardState(element, text, type) {
    if (!element) {
      return;
    }
    element.textContent = text;
    element.dataset.state = type || "idle";
  }

  async function saveModelSettings() {
    const nextConfig = collectFormConfig();
    state.config = nextConfig;
    await chrome.storage.local.set(nextConfig);
    await updateSetupProgress({ modelTestOk: false, modelTestAt: "" });
    await refreshReadiness();
    setFeedback("模型配置已保存。之后回到“采集”页点“测试模型”即可验证。", "success");
  }

  async function saveFeishuSettings() {
    const nextConfig = collectFormConfig();
    state.config = nextConfig;
    await chrome.storage.local.set(nextConfig);
    await updateSetupProgress({ feishuTestOk: false, feishuTestAt: "" });
    await refreshReadiness();
    await refreshCacheSummary();
    const mappingIssues = getFieldMappingIssues(nextConfig.fieldMapping);
    setFeedback(
      mappingIssues.length > 0
        ? `飞书配置已保存，但字段映射里有重复列名：${mappingIssues.join("、")}。调整后再采集会更稳。`
        : "飞书配置已保存。之后回到“采集”页点“测试飞书”即可验证。",
      mappingIssues.length > 0 ? "warning" : "success"
    );
  }

  function resetFieldMapping() {
    fillFieldMapping(DEFAULT_FIELD_MAPPING);
    setFeedback("字段映射已恢复为默认字段名。保存飞书配置后会正式生效。", "success");
  }

  async function clearSecrets() {
    if (!window.confirm("这会清空模型和飞书相关密钥，继续吗？")) {
      return;
    }

    state.config = {
      ...collectFormConfig(),
      githubToken: "",
      openaiApiKey: "",
      feishuAppId: "",
      feishuAppSecret: "",
      feishuBitableAppToken: "",
      feishuTableId: ""
    };

    fillForm(state.config);
    await chrome.storage.local.set(state.config);
    await updateSetupProgress(DEFAULT_SETUP_PROGRESS);
    await refreshReadiness();
    await refreshCacheSummary();
    setFeedback("敏感配置已清空。", "success");
  }

  async function testModelConnection() {
    const config = collectFormConfig();
    const missing = getMissingModelFields(config);
    if (missing.length > 0) {
      setFeedback(`请先补齐模型配置：${missing.join("、")}`, "error");
      return;
    }

    state.config = config;
    await chrome.storage.local.set(config);
    setButtonsLoading([elements.testModelBtn, elements.wizardTestModelBtn], true, "测试中...");

    try {
      const result = await sendRuntimeMessage({
        type: "testModel",
        config
      });
      await updateSetupProgress({
        modelTestOk: true,
        modelTestAt: new Date().toISOString()
      });
      const summary = cleanSingleLine(result.summary || "");
      setFeedback(
        `模型测试成功：${config.openaiModel}${summary ? ` · ${summary}` : ""}`,
        "success"
      );
    } catch (error) {
      await updateSetupProgress({
        modelTestOk: false,
        modelTestAt: new Date().toISOString()
      });
      setFeedback(`模型测试失败：${toMessage(error)}`, "error");
    } finally {
      setButtonsLoading([elements.testModelBtn, elements.wizardTestModelBtn], false);
      await loadLogs();
      refreshWizard();
    }
  }

  async function testFeishuConnection() {
    const config = collectFormConfig();
    const missing = getMissingFeishuFields(config);
    if (missing.length > 0) {
      setFeedback(`请先补齐飞书配置：${missing.join("、")}`, "error");
      return;
    }

    state.config = config;
    await chrome.storage.local.set(config);
    setButtonsLoading([elements.testFeishuBtn, elements.wizardTestFeishuBtn], true, "测试中...");

    try {
      const result = await sendRuntimeMessage({
        type: "testFeishu",
        config
      });
      await updateSetupProgress({
        feishuTestOk: true,
        feishuTestAt: new Date().toISOString()
      });
      setFeedback(`飞书鉴权通过，Token 预览：${result.tokenPreview || "-"}`, "success");
    } catch (error) {
      await updateSetupProgress({
        feishuTestOk: false,
        feishuTestAt: new Date().toISOString()
      });
      setFeedback(`飞书鉴权失败：${toMessage(error)}`, "error");
    } finally {
      setButtonsLoading([elements.testFeishuBtn, elements.wizardTestFeishuBtn], false);
      await loadLogs();
      refreshWizard();
    }
  }

  async function handleCollect() {
    if (!state.repoUrl) {
      setFeedback("请先打开一个 GitHub 仓库主页。", "error");
      return;
    }

    const config = collectFormConfig();
    const modelMissing = getMissingModelFields(config);
    if (modelMissing.length > 0) {
      switchTab("model");
      setFeedback(`请先补齐模型配置：${modelMissing.join("、")}`, "error");
      return;
    }

    const feishuMissing = getMissingFeishuFields(config);
    if (feishuMissing.length > 0) {
      switchTab("feishu");
      setFeedback(`请先补齐飞书配置：${feishuMissing.join("、")}`, "error");
      return;
    }

    const mappingIssues = getFieldMappingIssues(config.fieldMapping);
    if (mappingIssues.length > 0) {
      switchTab("feishu");
      setFeedback(`字段映射里有重复列名：${mappingIssues.join("、")}，请先调整后再采集。`, "error");
      return;
    }

    state.config = config;
    await chrome.storage.local.set(config);
    setButtonsLoading([elements.collectBtn, elements.wizardCollectBtn], true, "保存中...");
    setFeedback(`正在处理 ${state.repoLabel} ...`, "neutral");

    try {
      const result = await sendRuntimeMessage({
        type: "collectRepo",
        repoUrl: state.repoUrl,
        config
      });

      const actionText = result.skippedDuplicate ? "已识别为重复记录" : "已写入飞书";
      const aiText = result.aiUsed ? "AI 已调用" : "AI 回退";
      const duplicateText = result.duplicateReason ? ` · ${result.duplicateReason}` : "";

      setFeedback(
        `${actionText}：${result.repo} · 分类：${result.category || "未分类"} · ${aiText}${duplicateText}`,
        result.skippedDuplicate ? "warning" : "success"
      );

      await refreshCacheSummary();
      await loadRecentResult();
      refreshRecentResultCard();
      refreshWizard();
      playCollectMotion(result.skippedDuplicate ? "skipped" : "success");
    } catch (error) {
      setFeedback(`保存失败：${toMessage(error)}`, "error");
    } finally {
      setButtonsLoading([elements.collectBtn, elements.wizardCollectBtn], false);
      await loadLogs();
    }
  }

  async function loadLogs() {
    const stored = await chrome.storage.local.get({ [LOG_STORAGE_KEY]: [] });
    const logs = Array.isArray(stored[LOG_STORAGE_KEY]) ? stored[LOG_STORAGE_KEY] : [];

    if (logs.length === 0) {
      elements.logOutput.textContent = "暂无日志";
      return;
    }

    elements.logOutput.textContent = logs
      .slice(-40)
      .reverse()
      .map((entry) => {
        const time = entry.time || "-";
        const level = entry.level || "info";
        const stage = entry.stage || "general";
        const message = entry.message || "";
        return `[${time}] [${level}] [${stage}] ${message}`;
      })
      .join("\n");
  }

  async function clearLogs() {
    await chrome.storage.local.set({ [LOG_STORAGE_KEY]: [] });
    elements.logOutput.textContent = "暂无日志";
    setFeedback("日志已清空。", "success");
  }

  async function copyLogs() {
    const text = String(elements.logOutput.textContent || "").trim();
    if (!text || text === "暂无日志") {
      setFeedback("当前没有可复制的日志。", "warning");
      return;
    }

    try {
      await copyText(text);
      setFeedback("日志已复制，可直接粘贴到问题反馈、工单或群消息中。", "success");
    } catch (error) {
      setFeedback(`复制日志失败：${toMessage(error)}`, "error");
    }
  }

  async function clearCollectionCache() {
    setButtonsLoading([elements.clearCacheBtn], true, "清理中...");
    try {
      await sendRuntimeMessage({ type: "clearCollectionCache" });
      await refreshCacheSummary();
      await loadLogs();
      setFeedback("去重缓存已清空。", "success");
    } catch (error) {
      setFeedback(`清空去重缓存失败：${toMessage(error)}`, "error");
    } finally {
      setButtonsLoading([elements.clearCacheBtn], false);
    }
  }

  async function updateSetupProgress(patch) {
    state.setupProgress = {
      ...state.setupProgress,
      ...(patch || {})
    };
    await chrome.storage.local.set({
      [SETUP_PROGRESS_KEY]: state.setupProgress
    });
    refreshWizard();
  }

  function handleStorageChanged(changes, areaName) {
    if (areaName !== "local") {
      return;
    }

    if (changes[LOG_STORAGE_KEY]) {
      loadLogs();
    }

    if (changes[COLLECTION_INDEX_KEY]) {
      refreshCacheSummary();
    }

    if (changes[RECENT_RESULT_KEY]) {
      state.recentResult = changes[RECENT_RESULT_KEY].newValue || null;
      refreshRecentResultCard();
      refreshWizard();
    }

    if (changes[SETUP_PROGRESS_KEY]) {
      state.setupProgress = {
        ...DEFAULT_SETUP_PROGRESS,
        ...(changes[SETUP_PROGRESS_KEY].newValue || {})
      };
      refreshWizard();
    }

    if (changes[GUIDE_UI_KEY]) {
      state.guideUi = {
        ...DEFAULT_GUIDE_UI,
        ...(changes[GUIDE_UI_KEY].newValue || {})
      };
      refreshWizard();
    }
  }

  function getMissingModelFields(config) {
    return [
      ["模型接口地址", config.openaiBaseUrl],
      ["模型 API Key", config.openaiApiKey],
      ["模型名称", config.openaiModel]
    ]
      .filter((item) => !item[1])
      .map((item) => item[0]);
  }

  function getMissingFeishuFields(config) {
    return [
      ["飞书 App ID", config.feishuAppId],
      ["飞书 App Secret", config.feishuAppSecret],
      ["飞书多维表格 App Token", config.feishuBitableAppToken],
      ["飞书数据表 Table ID", config.feishuTableId]
    ]
      .filter((item) => !item[1])
      .map((item) => item[0]);
  }

  function getCollectionTableKey(config) {
    return `${String(config.feishuBitableAppToken || "").trim()}::${String(config.feishuTableId || "").trim()}`;
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

  function normalizeRepoIdentity(value) {
    const input = String(value || "").trim();
    if (!input) {
      return "";
    }

    const match = input.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
    if (!match) {
      return "";
    }

    return `${match[1].toLowerCase()}/${match[2].toLowerCase()}`;
  }

  async function sendRuntimeMessage(message) {
    try {
      return await sendRuntimeMessageOnce(message);
    } catch (error) {
      const errorText = toMessage(error);
      if (!/message port closed|receiving end does not exist/i.test(errorText)) {
        throw error;
      }

      await new Promise((resolve) => window.setTimeout(resolve, 280));

      try {
        return await sendRuntimeMessageOnce(message);
      } catch (retryError) {
        const retryText = toMessage(retryError);
        if (/message port closed|receiving end does not exist/i.test(retryText)) {
          throw new Error("扩展后台还没刷新到最新版本，请到扩展管理页点一次“重新加载”后再试。");
        }
        throw retryError;
      }
    }
  }

  async function sendRuntimeMessageOnce(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        if (!response || !response.ok) {
          reject(new Error((response && response.error) || "扩展后台没有返回有效结果"));
          return;
        }

        resolve(response);
      });
    });
  }

  function setButtonsLoading(buttons, loading, loadingText) {
    buttons
      .filter(Boolean)
      .forEach((button) => {
        if (button === elements.collectBtn || button === elements.wizardCollectBtn) {
          button.disabled = loading || !state.repoUrl;
        } else {
          button.disabled = loading;
        }
        button.textContent = loading ? loadingText : button.dataset.defaultText || button.textContent;
      });
  }

  function playCollectMotion(type) {
    if (!elements.recentResultCard || !elements.feedbackText) {
      return;
    }

    window.clearTimeout(state.collectMotionTimer);
    elements.recentResultCard.classList.remove("is-success", "is-skipped");
    elements.feedbackText.classList.remove("is-celebrating");

    if (type === "success") {
      elements.recentResultCard.classList.add("is-success");
      elements.feedbackText.classList.add("is-celebrating");
    } else if (type === "skipped") {
      elements.recentResultCard.classList.add("is-skipped");
    }

    state.collectMotionTimer = window.setTimeout(() => {
      elements.recentResultCard.classList.remove("is-success", "is-skipped");
      elements.feedbackText.classList.remove("is-celebrating");
    }, 1200);
  }

  function setFeedback(message, tone) {
    elements.feedbackText.textContent = message;
    elements.feedbackText.dataset.tone = tone || "neutral";
  }

  async function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }

    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }

  function formatDateTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "刚刚";
    }

    return new Intl.DateTimeFormat("zh-CN", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }).format(date);
  }

  function cleanSingleLine(text) {
    return String(text || "")
      .replace(/\s+/g, " ")
      .replace(/^["'`]+|["'`]+$/g, "")
      .trim();
  }

  function normalizeLooseText(value) {
    return cleanSingleLine(value).toLowerCase();
  }

  function isPlainObject(value) {
    return Object.prototype.toString.call(value) === "[object Object]";
  }

  function toMessage(error) {
    if (!error) {
      return "";
    }

    return error instanceof Error ? error.message : String(error);
  }
})();
