importScripts("freelancer.js", "ai.js", "budget.js");

const ALARM_NAME = "bidbot-poll";
const POLL_PERIOD_MINUTES = 0.5;
const MAX_TASKS_PER_TICK = 5;

let tickInProgress = false;

async function readSettings() {
  return chrome.storage.local.get([
    "apiBaseUrl",
    "workerId",
    "workerName",
    "signerName",
    "signerAddress",
    "signAgreements",
    "workerToken",
    "autoSubmit",
    "sealedBid",
    "humanTyping",
    "typingSpeed",
    "automationEnabled",
    "workerTabId",
    "aiProvider",
    "aiApiKey",
    "aiModel",
    "aiBaseUrl",
    "bidPrompt",
    "budgetRules"
  ]);
}

function aiSettingsFrom(settings) {
  return {
    provider: settings.aiProvider || "",
    apiKey: settings.aiApiKey || "",
    model: settings.aiModel || "",
    baseUrl: settings.aiBaseUrl || "",
    prompt: settings.bidPrompt || ""
  };
}

function hasLocalAi(settings) {
  return Boolean(settings.aiProvider && settings.aiApiKey);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isFreelancerUrl(url) {
  return /^https?:\/\/(www\.)?freelancer\.com\/.+/i.test(url || "");
}

async function apiFetch(settings, path, options = {}) {
  if (!settings.apiBaseUrl) {
    throw new Error("Server URL is not set in the side panel.");
  }
  const baseUrl = settings.apiBaseUrl.replace(/\/+$/, "");
  const headers = { "Content-Type": "application/json" };
  if (settings.workerToken) {
    headers["x-worker-token"] = settings.workerToken;
  }
  const response = await fetch(`${baseUrl}${path}`, { ...options, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${path} failed (${response.status}): ${payload.error || "no details"}`);
  }
  return payload;
}

function waitForTabComplete(tabId, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("Tab load timeout"));
    }, timeoutMs);

    function listener(updatedTabId, changeInfo) {
      if (updatedTabId === tabId && changeInfo.status === "complete") {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function navigateWorkerTab(url) {
  const { workerTabId } = await readSettings();
  let tab = null;
  if (workerTabId) {
    tab = await chrome.tabs.get(workerTabId).catch(() => null);
  }

  const loaded = tab ? waitForTabComplete(tab.id) : null;
  if (tab) {
    await chrome.tabs.update(tab.id, { url, active: true });
    await loaded;
    return tab;
  }

  tab = await chrome.tabs.create({ url, active: true });
  await chrome.storage.local.set({ workerTabId: tab.id });
  await waitForTabComplete(tab.id);
  return tab;
}

async function sendToTab(tabId, message, { attempts = 12, gapMs = 500 } = {}) {
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, message);
      if (!response?.ok) {
        throw new Error(response?.error || `${message.type} failed in page`);
      }
      return response;
    } catch (error) {
      lastError = error;
      if (!String(error.message).includes("Receiving end does not exist")) {
        throw error;
      }
      if (attempt === 2 || attempt === 6) {
        await injectContentScript(tabId);
      }
      await wait(gapMs);
    }
  }
  throw lastError;
}

async function injectContentScript(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ["content.js"]
    });
  } catch (_error) {
    // Tab may still be loading or a host we cannot inject into.
  }
}

async function fillBidInTab(tabId, settings, draft, { skipSign = false, terms = {} } = {}) {
  const { ok, ...fill } = await sendToTab(tabId, {
    type: "FILL_BID",
    draft,
    autoSubmit: Boolean(settings.autoSubmit),
    sealedBid: settings.sealedBid !== false,
    signAgreements: skipSign ? false : settings.signAgreements !== false,
    signerName: settings.signerName || settings.workerName || "",
    signerAddress: settings.signerAddress || "",
    bidAmount: (terms.bidAmount || "").trim(),
    bidDeadlineDays: (terms.bidDeadlineDays || "").trim(),
    humanTyping: settings.humanTyping !== false,
    typingSpeed: settings.typingSpeed || "3"
  });
  return fill;
}

async function waitForPageAfterSign(tabId) {
  await wait(1500);
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (tab && tab.status === "loading") {
    await waitForTabComplete(tabId, 12000).catch(() => {});
  }
  await wait(800);
}

async function inspectProjectPage(tabId, timeoutMs = 18000) {
  const start = Date.now();
  let last = { nda: false, bidReady: false, hasBidForm: false, kinds: [] };
  while (Date.now() - start < timeoutMs) {
    try {
      last = await sendToTab(tabId, { type: "DETECT_NDA" });
      if (last.nda || last.bidReady || last.hasBidForm) return last;
    } catch (_error) {
      // Content script may not be ready yet on a SPA navigation.
    }
    await wait(400);
  }
  return last;
}

async function waitForBidForm(tabId, timeoutMs = 20000) {
  const start = Date.now();
  let last = { nda: false, bidReady: false, hasBidForm: false, kinds: [] };
  while (Date.now() - start < timeoutMs) {
    try {
      last = await sendToTab(tabId, { type: "DETECT_NDA" });
      if (last.hasBidForm) return last;
    } catch (_error) {
      // Keep waiting for the bid form after NDA reload.
    }
    await wait(500);
  }
  return last;
}

function notifyBidProgress(text) {
  chrome.runtime.sendMessage({ type: "BID_PROGRESS", text }).catch(() => {});
}

function isSignTabUrl(url) {
  return /contracts\.freelancer\.com|hellosign|dropboxsign|\/nda|non[-\s]?disclosure|ip-agreement|ipagreement|embeddedsigning|contract-potential/i.test(
    url || ""
  );
}

async function waitForOpenedTab(beforeIds, timeoutMs = 15000) {
  const start = Date.now();
  let candidate = null;
  while (Date.now() - start < timeoutMs) {
    const tabs = await chrome.tabs.query({});
    const opened = tabs.filter((tab) => !beforeIds.has(tab.id));
    const ready = opened.find((tab) => {
      const url = tab.url || tab.pendingUrl || "";
      return isSignTabUrl(url) && !/^about:|chrome:/i.test(url);
    });
    if (ready) {
      if (ready.status === "complete") return ready;
      candidate = ready;
    } else if (opened[0] && !/^about:|chrome:/i.test(opened[0].url || "")) {
      candidate = opened[0];
    }
    await wait(300);
  }
  return candidate;
}

async function resolveAbsoluteHref(tabId, href) {
  if (!href || href.startsWith("javascript:") || href === "#") return "";
  try {
    const tab = await chrome.tabs.get(tabId);
    return new URL(href, tab.url).href;
  } catch (_error) {
    return href;
  }
}

async function fillAndCloseSignTab(signTabId, projectTabId, signerName, signerAddress, openedNew) {
  await wait(500);
  const tab = await chrome.tabs.get(signTabId).catch(() => null);
  if (tab && tab.status === "loading") {
    await waitForTabComplete(signTabId, 25000).catch(() => {});
  }
  await wait(800);
  await injectContentScript(signTabId);
  await wait(400);
  const filled = await sendToTab(
    signTabId,
    {
      type: "FILL_SIGNER_PAGE",
      signerName,
      signerAddress
    },
    { attempts: 16, gapMs: 400 }
  );
  await wait(800);
  if (openedNew && signTabId !== projectTabId) {
    await chrome.tabs.remove(signTabId).catch(() => {});
    await chrome.tabs.update(projectTabId, { active: true }).catch(() => {});
  }
  return filled;
}

async function signAgreementsFromProjectTab(projectTabId, settings) {
  const signerName = settings.signerName || settings.workerName || "";
  const signerAddress = settings.signerAddress || "";
  const projectTab = await chrome.tabs.get(projectTabId);
  const projectUrl = projectTab.url;
  const results = [];
  const seen = new Set();

  await chrome.storage.local.set({
    pendingAgreementSign: { signerName, signerAddress, at: Date.now() },
    agreementFrameResult: null
  });

  for (let round = 0; round < 4; round += 1) {
    const listed = await sendToTab(projectTabId, { type: "LIST_AGREEMENTS" });
    const next = (listed.agreements || []).find((item) => !seen.has(item.kind));
    if (!next) break;
    seen.add(next.kind);
    notifyBidProgress(`Clicking ${next.text || next.kind} once...`);

    const beforeIds = new Set((await chrome.tabs.query({})).map((tab) => tab.id));
    const clicked = await sendToTab(projectTabId, { type: "CLICK_AGREEMENT", kind: next.kind });
    let opened = await waitForOpenedTab(beforeIds, 15000);

    if (!opened) {
      const href = await resolveAbsoluteHref(projectTabId, clicked.href);
      if (href && href !== projectUrl) {
        notifyBidProgress("Opening the contract tab...");
        opened = await chrome.tabs.create({ url: href, active: true });
        await waitForTabComplete(opened.id, 25000).catch(() => {});
        opened = await chrome.tabs.get(opened.id).catch(() => opened);
      }
    }

    if (!opened) {
      throw new Error("NDA opened, but the contracts.freelancer.com tab was not found. Leave that tab open and try again.");
    }

    notifyBidProgress(`Signing ${next.kind} on the contract tab (not the project page)...`);
    const filled = await fillAndCloseSignTab(opened.id, projectTabId, signerName, signerAddress, true);
    results.push(filled.agreements || next.kind);

    await wait(800);
    await chrome.tabs.update(projectTabId, { url: projectUrl, active: true }).catch(() => {});
    await waitForTabComplete(projectTabId, 20000).catch(() => {});
    await wait(1000);
  }

  await chrome.storage.local.set({ pendingAgreementSign: null });
  return results.join("; ") || "none required";
}

async function createBidInTab(tabId, settings, serverDraft, url) {
  const signerName = settings.signerName || settings.workerName || "";
  const signerAddress = settings.signerAddress || "";
  notifyBidProgress("Checking if this project requires an NDA/IP signature...");
  let detect = await inspectProjectPage(tabId);
  let agreements = "none required";
  let signedNda = false;

  if (detect.nda) {
    notifyBidProgress("NDA/IP project — clicking each agreement once, then signing in the new tab.");
    if (settings.signAgreements === false) {
      throw new Error("This project requires an NDA/IP signature. Turn on auto-sign and fill Full legal name.");
    }
    if (!signerName.trim()) {
      throw new Error("This is an NDA/IP project. Fill Full legal name in the side panel first.");
    }
    agreements = await signAgreementsFromProjectTab(tabId, settings);
    signedNda = true;
    detect = await waitForBidForm(tabId, 15000);
    if (detect.nda && !detect.hasBidForm) {
      throw new Error(`NDA/IP was not completed (${agreements}). Check the NDA tab for + Add Signature / Full Name / Address.`);
    }
  } else {
    notifyBidProgress("Not an NDA project — reading the description and writing the bid.");
  }

  let project = null;
  let projectSource = "";
  let draft = serverDraft || "";
  let draftSource = serverDraft ? "server" : "";

  if (!serverDraft || signedNda) {
    notifyBidProgress("Reading the project description...");
    const read = await readProject(tabId, url, { preferPage: signedNda });
    project = read.project;
    projectSource = read.projectSource;
    notifyBidProgress("Sending the description to the API key and generating the bid...");
    const written = await writeDraft(settings, project);
    draft = written.draft;
    draftSource = written.draftSource;
  }

  if (!project) {
    try {
      const read = await readProject(tabId, url);
      project = read.project;
      projectSource = projectSource || read.projectSource;
    } catch (_error) {
      // Still try to bid; amount/days stay at Freelancer defaults if budget is unknown.
    }
  }

  const terms = BidBotBudget.resolveBidTerms(settings.budgetRules, project);
  if (terms.matched) {
    notifyBidProgress(`Setting bid to ${terms.summary}...`);
  } else {
    notifyBidProgress(`Budget rule not applied (${terms.note}). Leaving Freelancer's amount/days.`);
  }

  notifyBidProgress("Typing the bid...");
  const fill = await fillBidInTab(tabId, settings, draft, { skipSign: true, terms });
  const termsNote = [terms.note, fill.terms && fill.terms !== "unchanged" ? fill.terms : ""]
    .filter(Boolean)
    .join("; ");
  return { project, projectSource, draft, draftSource, ...fill, agreements, terms: termsNote };
}

async function readProject(tabId, url, { preferPage = false } = {}) {
  if (!preferPage) {
    try {
      const project = await BidBotFreelancer.fetchProject(url);
      if ((project.description || "").length > 80) {
        return { project, projectSource: "api" };
      }
    } catch (error) {
      console.warn("Freelancer API lookup failed, reading the page instead:", error.message);
    }
  }
  const { project } = await sendToTab(tabId, { type: "EXTRACT_PROJECT" });
  return { project, projectSource: "page" };
}

async function writeDraft(settings, project) {
  if (hasLocalAi(settings)) {
    return { draft: await BidBotAI.generateBid(project, aiSettingsFrom(settings)), draftSource: "extension" };
  }
  if (settings.apiBaseUrl) {
    const { draft } = await apiFetch(settings, "/api/draft-bid", {
      method: "POST",
      body: JSON.stringify({ project })
    });
    return { draft, draftSource: "server" };
  }
  throw new Error("No AI API key saved in the side panel and no Server URL to ask instead.");
}

async function reportTaskResult(settings, payload) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await apiFetch(settings, "/api/worker/task-result", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      return;
    } catch (error) {
      console.error("Result report failed:", error);
      await wait(2000);
    }
  }
}

async function processTask(settings, task) {
  const base = { taskId: task.id, workerId: settings.workerId };
  if (!isFreelancerUrl(task.url)) {
    await reportTaskResult(settings, { ...base, status: "fail", details: { error: "Invalid URL in task" } });
    return;
  }

  try {
    const tab = await navigateWorkerTab(task.url);
    const result = await createBidInTab(tab.id, settings, task.draft, task.url);
    await chrome.storage.local.set({ lastDraft: result.draft, lastDraftAt: new Date().toISOString() });
    await reportTaskResult(settings, {
      ...base,
      status: "success",
      details: {
        pageUrl: task.url,
        submitClicked: result.submitClicked,
        submitFound: result.submitFound,
        submitMethod: result.submitMethod,
        submitTarget: result.submitTarget,
        submitConfirmed: result.submitConfirmed,
        sealed: result.sealed,
        agreements: result.agreements,
        draftSource: result.draftSource,
        draft: result.draft || "",
        workerName: settings.workerName || ""
      }
    });
  } catch (error) {
    await reportTaskResult(settings, {
      ...base,
      status: "fail",
      details: { pageUrl: task.url, error: error.message }
    });
  }
}

async function processAutomationTick({ force = false } = {}) {
  if (tickInProgress) {
    return;
  }
  tickInProgress = true;
  try {
    const settings = await readSettings();
    if (!settings.automationEnabled && !force) {
      return;
    }
    if (!settings.workerId) {
      throw new Error("Worker ID is missing in settings.");
    }

    for (let count = 0; count < MAX_TASKS_PER_TICK; count += 1) {
      const { task } = await apiFetch(
        settings,
        `/api/worker/next-task?workerId=${encodeURIComponent(settings.workerId)}`
      );
      if (!task) {
        return;
      }
      await processTask(settings, task);
    }
  } finally {
    tickInProgress = false;
  }
}

async function enableAutomation() {
  await chrome.storage.local.set({ automationEnabled: true });
  await chrome.alarms.create(ALARM_NAME, { periodInMinutes: POLL_PERIOD_MINUTES });
}

async function disableAutomation() {
  await chrome.storage.local.set({ automationEnabled: false });
  await chrome.alarms.clear(ALARM_NAME);
}

function respondWith(promise, sendResponse) {
  promise
    .then((result) => sendResponse({ ok: true, ...(result || {}) }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
}

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.runtime.onStartup.addListener(async () => {
  const settings = await readSettings();
  if (settings.automationEnabled) {
    await chrome.alarms.create(ALARM_NAME, { periodInMinutes: POLL_PERIOD_MINUTES });
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    processAutomationTick().catch((error) => console.error("Automation tick failed:", error));
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "MANUAL_CREATE_BID_FROM_URL") {
    const url = (message.url || "").trim();
    if (!isFreelancerUrl(url)) {
      sendResponse({ ok: false, error: "Invalid Freelancer URL." });
      return false;
    }
    return respondWith(
      readSettings().then(async (settings) => {
        const tab = await navigateWorkerTab(url);
        const result = await createBidInTab(tab.id, settings, null, url);
        await chrome.storage.local.set({ lastDraft: result.draft, lastDraftAt: new Date().toISOString() });
        return result;
      }),
      sendResponse
    );
  }

  if (message?.type === "TYPING_PROGRESS") {
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === "MANUAL_OPEN_URL") {
    const url = (message.url || "").trim();
    if (!isFreelancerUrl(url)) {
      sendResponse({ ok: false, error: "Invalid Freelancer URL." });
      return false;
    }
    return respondWith(
      navigateWorkerTab(url).then((tab) => ({ tabId: tab.id, url: tab.url })),
      sendResponse
    );
  }

  if (message?.type === "AUTOMATION_START") {
    return respondWith(enableAutomation(), sendResponse);
  }
  if (message?.type === "AUTOMATION_STOP") {
    return respondWith(disableAutomation(), sendResponse);
  }
  if (message?.type === "AUTOMATION_RUN_NOW") {
    return respondWith(processAutomationTick({ force: true }), sendResponse);
  }
  return false;
});
