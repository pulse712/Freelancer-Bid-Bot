const $ = (id) => document.getElementById(id);

const statusEl = $("status");
const AUTO_ON_TEXT = "Auto is on. Checking the dashboard every few seconds for URLs sent to this Worker ID.";
const AUTO_OFF_TEXT = "Auto is off. Dashboard URLs will wait until you start Auto.";

const TEXT_FIELDS = {
  workerName: "workerName",
  workerId: "workerId",
  signerName: "signerName",
  signerAddress: "signerAddress",
  apiBaseUrl: "apiBaseUrl",
  workerToken: "workerToken",
  aiProvider: "aiProvider",
  aiApiKey: "aiApiKey",
  aiBaseUrl: "aiBaseUrl",
  bidPrompt: "bidPrompt",
  typingSpeed: "typingSpeed"
};
const CHECKBOXES = { autoSubmit: "autoSubmit", sealedBid: "sealedBid", humanTyping: "humanTyping", signAgreements: "signAgreements" };

let loadedModels = [];
let modelsRequestId = 0;
let budgetRules = BidBotBudget.DEFAULT_RULES.map((rule) => ({ ...rule }));
let pollTimer = null;

function setStatus(text, kind = "") {
  statusEl.textContent = text;
  statusEl.className = `status ${kind}`.trim();
}

function setHint(id, text, kind = "") {
  const element = $(id);
  element.textContent = text;
  element.className = `hint ${kind}`.trim();
}

function aiSettings() {
  return {
    provider: $("aiProvider").value,
    apiKey: $("aiApiKey").value.trim(),
    model: modelValue(),
    baseUrl: $("aiBaseUrl").value.trim(),
    prompt: $("bidPrompt").value
  };
}

function updateNameBadge() {
  const name = $("workerName").value.trim();
  $("nameBadge").textContent = name;
  $("nameBadge").hidden = !name;
}

// ----- model picker -----

function addModelOption(value, text) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = text;
  $("aiModel").appendChild(option);
}

function renderModelOptions(selected) {
  const fallback = BidBotAI.DEFAULT_MODELS[$("aiProvider").value];
  $("aiModel").textContent = "";
  addModelOption("", fallback ? `Provider default (${fallback})` : "Provider default");
  for (const model of loadedModels) {
    addModelOption(model.id, model.label ? `${model.label} - ${model.id}` : model.id);
  }
  if (selected && !loadedModels.some((model) => model.id === selected)) {
    addModelOption(selected, `${selected} (current)`);
  }
  addModelOption("__custom__", "Custom model...");
  $("aiModel").value = selected || "";
  toggleCustomModel();
}

function toggleCustomModel() {
  $("aiModelCustom").hidden = $("aiModel").value !== "__custom__";
}

function modelValue() {
  return $("aiModel").value === "__custom__" ? $("aiModelCustom").value.trim() : $("aiModel").value;
}

async function loadModels() {
  const settings = aiSettings();
  if (!settings.provider) {
    setHint("modelStatus", "Select a provider first.");
    return;
  }
  if (!settings.apiKey) {
    setHint("modelStatus", "Paste an API key to load the model list.");
    return;
  }
  const requestId = ++modelsRequestId;
  const current = modelValue();
  setHint("modelStatus", "Loading models...");
  $("loadModelsBtn").disabled = true;
  try {
    const models = await BidBotAI.listModels(settings);
    if (requestId !== modelsRequestId) return;
    loadedModels = models;
    renderModelOptions(current);
    setHint("modelStatus", `${models.length} models available for this key.`);
  } catch (error) {
    if (requestId !== modelsRequestId) return;
    loadedModels = [];
    renderModelOptions(current);
    setHint("modelStatus", `Could not load models: ${error.message}`, "error");
  } finally {
    if (requestId === modelsRequestId) $("loadModelsBtn").disabled = false;
  }
}

async function testKey() {
  const settings = aiSettings();
  if ($("aiModel").value === "__custom__" && !settings.model) {
    setHint("testMessage", "Type the custom model name, or pick a model from the list.", "error");
    return;
  }
  $("testKeyBtn").disabled = true;
  setHint("testMessage", "Testing API key...");
  try {
    const result = await BidBotAI.testConnection(settings);
    setHint("testMessage", `API key works. Model ${result.model} answered in ${result.latencyMs} ms: "${result.reply}"`, "ok");
  } catch (error) {
    setHint("testMessage", `API key check failed: ${error.message}`, "error");
  } finally {
    $("testKeyBtn").disabled = false;
  }
}

// ----- settings storage -----

async function loadSettings() {
  const stored = await chrome.storage.local.get([
    ...Object.keys(TEXT_FIELDS),
    ...Object.keys(CHECKBOXES),
    "aiModel",
    "automationEnabled",
    "lastDraft",
    "budgetRules"
  ]);
  for (const [key, id] of Object.entries(TEXT_FIELDS)) {
    if (stored[key] !== undefined) $(id).value = stored[key];
  }
  for (const [key, id] of Object.entries(CHECKBOXES)) {
    if (stored[key] !== undefined) $(id).checked = Boolean(stored[key]);
  }
  const speedMap = { fast: "3", normal: "10", slow: "10", "8": "3", "15": "10", "25": "10" };
  const speed = speedMap[stored.typingSpeed] || stored.typingSpeed;
  $("typingSpeed").value = [...$("typingSpeed").options].some((option) => option.value === speed) ? speed : "3";
  if (!$("bidPrompt").value) $("bidPrompt").value = BidBotAI.DEFAULT_PROMPT;
  $("placeholderHint").textContent =
    "Placeholders filled from the project: " + BidBotAI.PLACEHOLDERS.map((name) => `{${name}}`).join(" ");
  $("autoStatus").textContent = stored.automationEnabled ? AUTO_ON_TEXT : AUTO_OFF_TEXT;
  $("draftOutput").value = stored.lastDraft || "";
  budgetRules = BidBotBudget.coerceRules(stored.budgetRules);
  renderBudgetRules();
  updateNameBadge();
  renderModelOptions(stored.aiModel || "");
  if ($("aiProvider").value && $("aiApiKey").value) loadModels();
  if (stored.automationEnabled) {
    startLocalPoll();
    sendToBackground("AUTOMATION_TICK").catch(() => {});
  }
}

async function saveSettings() {
  const data = { aiModel: modelValue() };
  for (const [key, id] of Object.entries(TEXT_FIELDS)) {
    data[key] = $(id).value.trim();
  }
  data.bidPrompt = $("bidPrompt").value;
  for (const [key, id] of Object.entries(CHECKBOXES)) {
    data[key] = $(id).checked;
  }
  data.budgetRules = readBudgetRulesFromDom();
  budgetRules = BidBotBudget.coerceRules(data.budgetRules);
  await chrome.storage.local.set(data);
  updateNameBadge();
}

function ruleInput(name, value, placeholder) {
  const input = document.createElement("input");
  input.type = "text";
  input.inputMode = "decimal";
  input.dataset.field = name;
  input.value = value === "" || value == null ? "" : String(value);
  input.placeholder = placeholder;
  input.addEventListener("change", saveSettings);
  return input;
}

function renderRuleRow(rule) {
  const row = document.createElement("div");
  row.className = `rule-row ${rule.type}`;
  row.dataset.id = rule.id;
  row.dataset.type = rule.type;
  row.append(ruleInput("min", rule.min, "min"), Object.assign(document.createElement("span"), { className: "dash", textContent: "~" }), ruleInput("max", rule.max, "max"), Object.assign(document.createElement("span"), { className: "arrow", textContent: "→" }), ruleInput("bid", rule.bid, rule.type === "hourly" ? "$/hr" : "bid"));
  if (rule.type === "fixed") {
    row.append(ruleInput("days", rule.days, "days"));
  }
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "rule-remove";
  remove.title = "Remove this range";
  remove.textContent = "×";
  remove.addEventListener("click", () => {
    budgetRules = readBudgetRulesFromDom().filter((item) => item.id !== rule.id);
    renderBudgetRules();
    saveSettings();
  });
  row.append(remove);
  return row;
}

function renderBudgetRules() {
  const fixed = $("fixedRules");
  const hourly = $("hourlyRules");
  fixed.textContent = "";
  hourly.textContent = "";
  for (const rule of budgetRules) {
    (rule.type === "hourly" ? hourly : fixed).append(renderRuleRow(rule));
  }
}

function readBudgetRulesFromDom() {
  return [...document.querySelectorAll(".rule-row")].map((row) => {
    const valueOf = (name) => row.querySelector(`[data-field="${name}"]`)?.value.trim() || "";
    return {
      id: row.dataset.id,
      type: row.dataset.type,
      min: valueOf("min"),
      max: valueOf("max"),
      bid: valueOf("bid"),
      days: valueOf("days")
    };
  });
}

function addBudgetRule(type) {
  const current = readBudgetRulesFromDom();
  const last = [...current].reverse().find((rule) => rule.type === type);
  const lastMax = Number(last?.max);
  const lastBid = Number(last?.bid);
  budgetRules = [
    ...current,
    {
      id: BidBotBudget.newRuleId(),
      type,
      min: Number.isFinite(lastMax) ? lastMax : type === "hourly" ? 15 : 30,
      max: Number.isFinite(lastMax) ? lastMax * 2 : type === "hourly" ? 25 : 250,
      bid: Number.isFinite(lastBid) ? lastBid : type === "hourly" ? 20 : 120,
      days: type === "hourly" ? "" : last?.days || 1
    }
  ];
  renderBudgetRules();
  saveSettings();
}

function serverReady() {
  return Boolean($("apiBaseUrl").value.trim() && $("workerId").value.trim());
}

function startLocalPoll() {
  if (pollTimer) return;
  pollTimer = setInterval(() => {
    sendToBackground("AUTOMATION_TICK").catch(() => {});
  }, 3000);
}

function stopLocalPoll() {
  if (!pollTimer) return;
  clearInterval(pollTimer);
  pollTimer = null;
}

async function startAutomation() {
  await saveSettings();
  if (!serverReady()) throw new Error("Set the Server URL and Worker ID first.");
  await sendToBackground("AUTOMATION_START");
  startLocalPoll();
  $("autoStatus").textContent = AUTO_ON_TEXT;
}

async function sendToBackground(type, extra = {}) {
  const response = await chrome.runtime.sendMessage({ type, ...extra });
  if (!response?.ok) {
    throw new Error(response?.error || `${type} failed`);
  }
  return response;
}

// ----- project actions -----

function readManualUrl() {
  let url = $("manualProjectUrl").value.trim();
  if (!url) {
    setStatus("Enter a Freelancer URL first.", "error");
    return null;
  }
  if (!/^https?:\/\//i.test(url)) {
    url = `https://${url}`;
    $("manualProjectUrl").value = url;
  }
  if (!/^https?:\/\/(www\.)?freelancer\.com\/.+/i.test(url)) {
    setStatus("That is not a freelancer.com link.", "error");
    return null;
  }
  return url;
}

async function openManualUrl() {
  const url = readManualUrl();
  if (!url) return;
  $("openUrlBtn").disabled = true;
  try {
    setStatus("Opening project page...");
    await sendToBackground("MANUAL_OPEN_URL", { url });
    setStatus("Project page opened in the worker tab.", "ok");
  } catch (error) {
    setStatus(`Could not open the page: ${error.message}`, "error");
  } finally {
    $("openUrlBtn").disabled = false;
  }
}

async function createBidFromUrl() {
  const url = readManualUrl();
  if (!url) return;
  const settings = aiSettings();
  if (!settings.apiKey && !$("apiBaseUrl").value.trim()) {
    setStatus("Add an AI API key (or a Server URL) before creating bids.", "error");
    return;
  }
  const button = $("createBidFromUrlBtn");
  button.disabled = true;
  try {
    await saveSettings();
    setStatus("Opening the project...");
    const result = await sendToBackground("MANUAL_CREATE_BID_FROM_URL", { url });
    $("draftOutput").value = result.draft || "";
    const source = result.draftSource === "extension" ? "this panel's API key" : "the server";
    const notes = [];
    if (result.agreements) notes.push(`Agreements: ${result.agreements}`);
    if (result.terms && result.terms !== "unchanged") notes.push(`Terms: ${result.terms}`);
    if (result.sealed && result.sealed !== "skipped") notes.push(`Sealed: ${result.sealed}`);
    if (!result.submitClicked) {
      notes.push(result.submitFound ? `Place Bid button found: ${result.submitTarget}` : "Place Bid button NOT found");
    } else {
      notes.push(
        result.submitConfirmed
          ? `clicked ${result.submitTarget} via ${result.submitMethod}, page reacted: ${result.submitConfirmed}`
          : `clicked ${result.submitTarget} via ${result.submitMethod}, but the page did not visibly change - check it`
      );
      if (result.submitNote && result.submitNote !== result.submitConfirmed) notes.push(result.submitNote);
    }
    const suffix = notes.length ? ` (${notes.join("; ")})` : "";
    const good = result.submitClicked ? Boolean(result.submitConfirmed) : result.submitFound;
    setStatus(
      (result.submitClicked ? `Bid typed and submitted, written by ${source}.` : `Bid typed, not submitted, written by ${source}.`) + suffix,
      good ? "ok" : "error"
    );
  } catch (error) {
    setStatus(`Bid failed: ${error.message}`, "error");
  } finally {
    button.disabled = false;
  }
}

// ----- events -----

for (const id of Object.values(TEXT_FIELDS)) {
  $(id).addEventListener("change", saveSettings);
}
for (const id of Object.values(CHECKBOXES)) {
  $(id).addEventListener("change", saveSettings);
}
$("workerName").addEventListener("input", updateNameBadge);

$("aiProvider").addEventListener("change", () => {
  loadedModels = [];
  renderModelOptions("");
  setHint("modelStatus", "");
  saveSettings();
  if ($("aiApiKey").value.trim()) loadModels();
});
$("aiApiKey").addEventListener("change", () => {
  if ($("aiProvider").value) loadModels();
});
$("aiModel").addEventListener("change", () => {
  toggleCustomModel();
  saveSettings();
});
$("aiModelCustom").addEventListener("change", saveSettings);
$("loadModelsBtn").addEventListener("click", loadModels);
$("testKeyBtn").addEventListener("click", testKey);

$("resetPromptBtn").addEventListener("click", () => {
  $("bidPrompt").value = BidBotAI.DEFAULT_PROMPT;
  saveSettings();
  setStatus("Bid prompt reset to the default.", "ok");
});

$("openUrlBtn").addEventListener("click", openManualUrl);
$("manualProjectUrl").addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    openManualUrl();
  }
});
$("createBidFromUrlBtn").addEventListener("click", createBidFromUrl);
$("addFixedRuleBtn").addEventListener("click", () => addBudgetRule("fixed"));
$("addHourlyRuleBtn").addEventListener("click", () => addBudgetRule("hourly"));
$("resetBudgetRulesBtn").addEventListener("click", () => {
  budgetRules = BidBotBudget.DEFAULT_RULES.map((rule) => ({ ...rule }));
  renderBudgetRules();
  saveSettings();
  setStatus("Budget ranges reset to the examples.", "ok");
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "BID_PROGRESS" && message.text) setStatus(message.text);
});

$("startAutoBtn").addEventListener("click", async () => {
  try {
    await startAutomation();
    setStatus("Auto is on. Dashboard URLs for this Worker ID will be bid on automatically.", "ok");
  } catch (error) {
    setStatus(`Could not start automation: ${error.message}`, "error");
  }
});

$("stopAutoBtn").addEventListener("click", async () => {
  try {
    stopLocalPoll();
    await sendToBackground("AUTOMATION_STOP");
    $("autoStatus").textContent = AUTO_OFF_TEXT;
    setStatus("Auto stopped. Dashboard URLs will wait.", "ok");
  } catch (error) {
    setStatus(`Could not stop automation: ${error.message}`, "error");
  }
});

$("runNowBtn").addEventListener("click", async () => {
  try {
    await saveSettings();
    setStatus("Checking the dashboard for URLs...");
    await sendToBackground("AUTOMATION_RUN_NOW");
    setStatus("Check finished. Results are on the dashboard.", "ok");
  } catch (error) {
    setStatus(`Run failed: ${error.message}`, "error");
  }
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.lastDraft) $("draftOutput").value = changes.lastDraft.newValue || "";
});

loadSettings().catch((error) => setStatus(`Could not load settings: ${error.message}`, "error"));
