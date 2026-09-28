const DEFAULT_API_BASE_URL = "http://localhost:8787";

const statusEl = document.getElementById("status");
const autoStatusEl = document.getElementById("autoStatus");
const draftOutputEl = document.getElementById("draftOutput");
const apiBaseUrlEl = document.getElementById("apiBaseUrl");
const workerIdEl = document.getElementById("workerId");
const workerTokenEl = document.getElementById("workerToken");
const autoSubmitEl = document.getElementById("autoSubmit");
const manualProjectUrlEl = document.getElementById("manualProjectUrl");

const AUTO_ON_TEXT = "Auto mode is on. Checking the server for tasks every 30 seconds.";
const AUTO_OFF_TEXT = "Auto mode is off.";

function setStatus(text) {
  statusEl.textContent = text;
}

async function loadSettings() {
  const stored = await chrome.storage.local.get([
    "apiBaseUrl",
    "workerId",
    "workerToken",
    "autoSubmit",
    "automationEnabled"
  ]);
  apiBaseUrlEl.value = stored.apiBaseUrl || DEFAULT_API_BASE_URL;
  workerIdEl.value = stored.workerId || "";
  workerTokenEl.value = stored.workerToken || "";
  autoSubmitEl.checked = Boolean(stored.autoSubmit);
  autoStatusEl.textContent = stored.automationEnabled ? AUTO_ON_TEXT : AUTO_OFF_TEXT;
}

async function saveSettings() {
  await chrome.storage.local.set({
    apiBaseUrl: apiBaseUrlEl.value.trim() || DEFAULT_API_BASE_URL,
    workerId: workerIdEl.value.trim(),
    workerToken: workerTokenEl.value.trim(),
    autoSubmit: autoSubmitEl.checked
  });
}

async function sendToBackground(type, extra = {}) {
  const response = await chrome.runtime.sendMessage({ type, ...extra });
  if (!response?.ok) {
    throw new Error(response?.error || `${type} failed`);
  }
  return response;
}

for (const element of [apiBaseUrlEl, workerIdEl, workerTokenEl]) {
  element.addEventListener("blur", saveSettings);
}
autoSubmitEl.addEventListener("change", saveSettings);

document.getElementById("createBidFromUrlBtn").addEventListener("click", async () => {
  const url = manualProjectUrlEl.value.trim();
  if (!url) {
    setStatus("Enter a Freelancer URL first.");
    return;
  }
  try {
    await saveSettings();
    setStatus("Opening project and requesting bid from server...");
    const result = await sendToBackground("MANUAL_CREATE_BID_FROM_URL", { url });
    draftOutputEl.value = result.draft || "";
    setStatus(result.submitClicked ? "Bid filled and submitted." : "Bid filled (not submitted).");
  } catch (error) {
    setStatus(`Manual run failed: ${error.message}`);
  }
});

document.getElementById("startAutoBtn").addEventListener("click", async () => {
  try {
    await saveSettings();
    await sendToBackground("AUTOMATION_START");
    autoStatusEl.textContent = AUTO_ON_TEXT;
    setStatus("Automation started.");
  } catch (error) {
    setStatus(`Could not start automation: ${error.message}`);
  }
});

document.getElementById("stopAutoBtn").addEventListener("click", async () => {
  try {
    await sendToBackground("AUTOMATION_STOP");
    autoStatusEl.textContent = AUTO_OFF_TEXT;
    setStatus("Automation stopped.");
  } catch (error) {
    setStatus(`Could not stop automation: ${error.message}`);
  }
});

document.getElementById("runNowBtn").addEventListener("click", async () => {
  try {
    await saveSettings();
    setStatus("Checking server for tasks...");
    await sendToBackground("AUTOMATION_RUN_NOW");
    setStatus("Check finished. Results are on the server dashboard.");
  } catch (error) {
    setStatus(`Run failed: ${error.message}`);
  }
});

loadSettings().catch((error) => setStatus(`Could not load settings: ${error.message}`));
