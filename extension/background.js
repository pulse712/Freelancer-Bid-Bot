importScripts("freelancer.js", "ai.js");

const ALARM_NAME = "bidbot-poll";
const POLL_PERIOD_MINUTES = 0.5;
const MAX_TASKS_PER_TICK = 5;

let tickInProgress = false;

async function readSettings() {
  return chrome.storage.local.get([
    "apiBaseUrl",
    "workerId",
    "workerName",
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
    "bidPrompt"
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

async function sendToTab(tabId, message) {
  let lastError = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
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
      await wait(500);
    }
  }
  throw lastError;
}

async function fillBidInTab(tabId, settings, draft) {
  const { ok, ...fill } = await sendToTab(tabId, {
    type: "FILL_BID",
    draft,
    autoSubmit: Boolean(settings.autoSubmit),
    sealedBid: settings.sealedBid !== false,
    humanTyping: settings.humanTyping !== false,
    typingSpeed: settings.typingSpeed || "8"
  });
  return fill;
}

async function readProject(tabId, url) {
  try {
    return { project: await BidBotFreelancer.fetchProject(url), projectSource: "api" };
  } catch (error) {
    console.warn("Freelancer API lookup failed, reading the page instead:", error.message);
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

async function createBidInTab(tabId, settings, serverDraft, url) {
  if (serverDraft) {
    const fill = await fillBidInTab(tabId, settings, serverDraft);
    return { draft: serverDraft, draftSource: "server", ...fill };
  }

  const { project, projectSource } = await readProject(tabId, url);
  const { draft, draftSource } = await writeDraft(settings, project);
  const fill = await fillBidInTab(tabId, settings, draft);
  return { project, projectSource, draft, draftSource, ...fill };
}

// Sends a real mouse click through Chrome's debugger interface. The page sees a trusted click,
// exactly as if the user pressed the mouse at that spot. Coordinates are CSS pixels in the viewport.
async function trustedClick(tabId, x, y) {
  const target = { tabId };
  await chrome.debugger.attach(target, "1.3");
  try {
    const base = { x: Math.round(x), y: Math.round(y), button: "left", clickCount: 1 };
    await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", { ...base, type: "mouseMoved" });
    await wait(60 + Math.random() * 80);
    await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", { ...base, type: "mousePressed", buttons: 1 });
    await wait(50 + Math.random() * 90);
    await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", { ...base, type: "mouseReleased", buttons: 0 });
  } finally {
    await chrome.debugger.detach(target).catch(() => {});
  }
  return {};
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
        submitConfirmed: result.submitConfirmed,
        sealed: result.sealed,
        draftSource: result.draftSource,
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

  if (message?.type === "TRUSTED_CLICK") {
    const tabId = _sender?.tab?.id;
    if (!tabId) {
      sendResponse({ ok: false, error: "No tab for trusted click" });
      return false;
    }
    return respondWith(trustedClick(tabId, message.x, message.y), sendResponse);
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
