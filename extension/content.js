(function () {
  "use strict";

  const BUTTON_ID = "gh-feishu-extension-button";
  const TOAST_ID = "gh-feishu-extension-toast";
  const ICON_URL = chrome.runtime.getURL("icons/collector-mark.svg");
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

  let currentRepoKey = "";
  let renderTimer = null;

  injectStyles();
  init();

  function init() {
    ensureUi();

    const observer = new MutationObserver(scheduleEnsureUi);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });

    window.addEventListener("popstate", scheduleEnsureUi);
    document.addEventListener("turbo:render", scheduleEnsureUi, true);
    document.addEventListener("pjax:end", scheduleEnsureUi, true);
  }

  function injectStyles() {
    if (document.getElementById(`${BUTTON_ID}-style`)) {
      return;
    }

    const style = document.createElement("style");
    style.id = `${BUTTON_ID}-style`;
    style.textContent = `
      #${BUTTON_ID} {
        position: fixed;
        right: 24px;
        bottom: 24px;
        z-index: 99999;
        display: inline-flex;
        align-items: center;
        gap: 10px;
        padding: 11px 16px 11px 12px;
        border: 1px solid rgba(15, 56, 42, 0.14);
        border-radius: 999px;
        background: linear-gradient(135deg, #0f8f7b 0%, #0e6f63 100%);
        color: #fff;
        font-size: 14px;
        font-weight: 700;
        line-height: 1;
        cursor: pointer;
        box-shadow: 0 18px 36px rgba(16, 54, 76, 0.24);
        transition: transform 0.15s ease, opacity 0.15s ease, filter 0.15s ease;
      }

      #${BUTTON_ID} img {
        width: 20px;
        height: 20px;
        border-radius: 7px;
        box-shadow: 0 8px 16px rgba(6, 25, 37, 0.2);
        flex: 0 0 auto;
      }

      #${BUTTON_ID} span {
        display: inline-block;
      }

      #${BUTTON_ID}:hover {
        transform: translateY(-2px);
        filter: saturate(1.06);
      }

      #${BUTTON_ID}[data-loading="true"] {
        opacity: 0.78;
        cursor: progress;
      }

      #${TOAST_ID} {
        position: fixed;
        right: 24px;
        bottom: 86px;
        max-width: 360px;
        z-index: 100000;
        padding: 13px 14px;
        border-radius: 18px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        background: rgba(15, 23, 42, 0.95);
        color: #fff;
        font-size: 13px;
        line-height: 1.55;
        box-shadow: 0 18px 36px rgba(15, 23, 42, 0.28);
        opacity: 0;
        transform: translateY(8px);
        transition: opacity 0.18s ease, transform 0.18s ease;
        pointer-events: none;
        white-space: pre-wrap;
      }

      #${TOAST_ID}[data-show="true"] {
        opacity: 1;
        transform: translateY(0);
      }
    `;

    document.documentElement.appendChild(style);
  }

  function scheduleEnsureUi() {
    window.clearTimeout(renderTimer);
    renderTimer = window.setTimeout(ensureUi, 220);
  }

  function ensureUi() {
    const repoInfo = getRepoInfo();
    const existingButton = document.getElementById(BUTTON_ID);

    if (!repoInfo) {
      if (existingButton) {
        existingButton.remove();
      }
      currentRepoKey = "";
      return;
    }

    const repoKey = `${repoInfo.owner}/${repoInfo.repo}`;
    if (existingButton && currentRepoKey === repoKey) {
      return;
    }

    if (existingButton) {
      existingButton.remove();
    }

    currentRepoKey = repoKey;

    const button = document.createElement("button");
    button.id = BUTTON_ID;
    button.type = "button";
    button.innerHTML = `<img src="${ICON_URL}" alt="" /><span>存到飞书</span>`;
    button.addEventListener("click", () => submitRepo(repoInfo, button));
    document.body.appendChild(button);
  }

  function getRepoInfo() {
    const metaRepo = document.querySelector('meta[name="octolytics-dimension-repository_nwo"]');
    if (metaRepo && metaRepo.content.includes("/")) {
      const [owner, repo] = metaRepo.content.split("/");
      if (owner && repo) {
        return { owner, repo };
      }
    }

    const segments = window.location.pathname.split("/").filter(Boolean);
    if (segments.length < 2) {
      return null;
    }

    const owner = segments[0];
    const repo = segments[1].replace(/\.git$/i, "");
    if (!owner || !repo || RESERVED_PATHS.has(owner.toLowerCase())) {
      return null;
    }

    return { owner, repo };
  }

  function submitRepo(repoInfo, button) {
    if (!repoInfo || button.dataset.loading === "true") {
      return;
    }

    button.dataset.loading = "true";
    button.innerHTML = `<img src="${ICON_URL}" alt="" /><span>保存中...</span>`;

    let finished = false;
    const timeoutId = window.setTimeout(() => {
      if (finished) {
        return;
      }

      finished = true;
      button.dataset.loading = "false";
      button.innerHTML = `<img src="${ICON_URL}" alt="" /><span>存到飞书</span>`;
      showToast("请求超时，请打开扩展弹窗查看最近日志。", true);
    }, 45000);

    chrome.runtime.sendMessage(
      {
        type: "collectRepo",
        repoUrl: `https://github.com/${repoInfo.owner}/${repoInfo.repo}`
      },
      (response) => {
        if (finished) {
          return;
        }

        finished = true;
        window.clearTimeout(timeoutId);
        button.dataset.loading = "false";
        button.innerHTML = `<img src="${ICON_URL}" alt="" /><span>存到飞书</span>`;

        if (chrome.runtime.lastError) {
          showToast(`连接扩展后台失败：${chrome.runtime.lastError.message}`, true);
          return;
        }

        if (!response || !response.ok) {
          showToast((response && response.error) || "保存失败，请检查扩展配置。", true);
          return;
        }

        const headline = response.skippedDuplicate ? "已跳过重复记录" : "已写入飞书";
        const duplicateText = response.duplicateReason ? `\n${response.duplicateReason}` : "";
        const aiText = response.aiUsed ? "AI 已调用" : "AI 回退";

        showToast(`${headline}：${response.repo}\n分类：${response.category || "未分类"}\n${aiText}${duplicateText}`);
      }
    );
  }

  function showToast(message, isError) {
    let toast = document.getElementById(TOAST_ID);
    if (!toast) {
      toast = document.createElement("div");
      toast.id = TOAST_ID;
      document.body.appendChild(toast);
    }

    toast.style.background = isError ? "rgba(122, 28, 28, 0.96)" : "rgba(15, 23, 42, 0.95)";
    toast.textContent = message;
    toast.dataset.show = "true";

    window.clearTimeout(showToast.timerId);
    showToast.timerId = window.setTimeout(() => {
      toast.dataset.show = "false";
    }, 4200);
  }
})();
