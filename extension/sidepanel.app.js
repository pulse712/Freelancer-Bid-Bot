const statusEl = document.getElementById("status");
const projectDataEl = document.getElementById("projectData");
const draftOutputEl = document.getElementById("draftOutput");
const apiBaseUrlEl = document.getElementById("apiBaseUrl");
const profileInputEl = document.getElementById("profileInput");
const workerIdEl = document.getElementById("workerId");
const workerTokenEl = document.getElementById("workerToken");
const aiProviderEl = document.getElementById("aiProvider");
const aiApiKeyEl = document.getElementById("aiApiKey");
const aiModelEl = document.getElementById("aiModel");
const aiBaseUrlEl = document.getElementById("aiBaseUrl");
const autoSubmitEl = document.getElementById("autoSubmit");
const autoStatusEl = document.getElementById("autoStatus");
const manualProjectUrlEl = document.getElementById("manualProjectUrl");
const extractBtn = document.getElementById("extractBtn");
const draftBtn = document.getElementById("draftBtn");
const createBidFromUrlBtn = document.getElementById("createBidFromUrlBtn");
const startAutoBtn = document.getElementById("startAutoBtn");
const stopAutoBtn = document.getElementById("stopAutoBtn");
const runNowBtn = document.getElementById("runNowBtn");

const DEFAULT_API_BASE_URL = "http://localhost:8787";
let currentProject = null;

function setStatus(text) {
  statusEl.textContent = text;
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

async function loadSettings() {
  const stored = await chrome.storage.local.get([
    "apiBaseUrl",
    "profileSummary",
    "workerId",
    "workerToken",
    "aiProvider",
    "aiApiKey",
    "aiModel",
    "aiBaseUrl",
    "autoSubmit",
    "automationEnabled"
  ]);
  apiBaseUrlEl.value = stored.apiBaseUrl || DEFAULT_API_BASE_URL;
  profileInputEl.value = stored.profileSummary || "";
  workerIdEl.value = stored.workerId || "";
  workerTokenEl.value = stored.workerToken || "";
  aiProviderEl.value = stored.aiProvider || "";
  aiApiKeyEl.value = stored.aiApiKey || "";
  aiModelEl.value = stored.aiModel || "";
  aiBaseUrlEl.value = stored.aiBaseUrl || "";
  autoSubmitEl.checked = Boolean(stored.autoSubmit);
  autoStatusEl.textContent = stored.automationEnabled
    ? "Auto mode is on. Polling server queue."
    : "Auto mode is off.";
}

async function saveSettings() {
  await chrome.storage.local.set({
    apiBaseUrl: apiBaseUrlEl.value.trim() || DEFAULT_API_BASE_URL,
    profileSummary: profileInputEl.value.trim(),
    workerId: workerIdEl.value.trim(),
    workerToken: workerTokenEl.value.trim(),
    aiProvider: aiProviderEl.value.trim(),
    aiApiKey: aiApiKeyEl.value.trim(),
    aiModel: aiModelEl.value.trim(),
    aiBaseUrl: aiBaseUrlEl.value.trim(),
    autoSubmit: autoSubmitEl.checked
  });
}

async function requestDraftFromBackend(project) {
  const apiBaseUrl = (apiBaseUrlEl.value.trim() || DEFAULT_API_BASE_URL).replace(/\/+$/, "");
  const profileSummary = profileInputEl.value.trim();
  const headers = { "Content-Type": "application/json" };
  if (workerTokenEl.value.trim()) {
    headers["x-worker-token"] = workerTokenEl.value.trim();
  }
  const aiConfig = {
    provider: aiProviderEl.value.trim(),
    apiKey: aiApiKeyEl.value.trim(),
    model: aiModelEl.value.trim(),
    baseUrl: aiBaseUrlEl.value.trim()
  };

  const response = await fetch(`${apiBaseUrl}/api/draft-bid`, {
    method: "POST",
    headers,
    body: JSON.stringify({ project, profileSummary, aiConfig })
  });

  if (!response.ok) {
    throw new Error(`Backend error ${response.status}`);
  }

  const payload = await response.json();
  if (!payload?.draft) {
    throw new Error("Missing draft text from backend");
  }
  return payload;
}

extractBtn.addEventListener("click", async () => {
  try {
    await saveSettings();
    const tab = await getActiveTab();

    if (!tab?.id || !tab.url?.includes("freelancer.com")) {
      setStatus("Open a Freelancer project page first.");
      return;
    }

    const response = await chrome.tabs.sendMessage(tab.id, {
      type: "EXTRACT_PROJECT"
    });

    if (!response?.ok) {
      setStatus("Could not extract project data.");
      return;
    }

    currentProject = response.project;
    projectDataEl.textContent = JSON.stringify(currentProject, null, 2);
    draftBtn.disabled = false;
    setStatus("Project extracted.");
  } catch (error) {
    console.error(error);
    setStatus("Failed. Refresh the tab and retry.");
  }
});

draftBtn.addEventListener("click", async () => {
  if (!currentProject) {
    setStatus("Extract a project first.");
    return;
  }

  try {
    await saveSettings();
    setStatus("Generating draft from backend...");
    const result = await requestDraftFromBackend(currentProject);
    draftOutputEl.value = result.draft;
    if (result.source === "template" || result.source === "template-fallback") {
      setStatus("Draft generated from template fallback.");
    } else {
      setStatus("Draft generated from AI backend.");
    }
  } catch (error) {
    console.error(error);
    setStatus("Draft failed. Ensure backend is running.");
  }
});

apiBaseUrlEl.addEventListener("blur", saveSettings);
profileInputEl.addEventListener("blur", saveSettings);
workerIdEl.addEventListener("blur", saveSettings);
workerTokenEl.addEventListener("blur", saveSettings);
aiProviderEl.addEventListener("change", saveSettings);
aiApiKeyEl.addEventListener("blur", saveSettings);
aiModelEl.addEventListener("blur", saveSettings);
aiBaseUrlEl.addEventListener("blur", saveSettings);
autoSubmitEl.addEventListener("change", saveSettings);

createBidFromUrlBtn.addEventListener("click", async () => {
  try {
    await saveSettings();
    const url = manualProjectUrlEl.value.trim();
    if (!url) {
      setStatus("Enter a Freelancer URL first.");
      return;
    }

    setStatus("Opening URL and creating bid...");
    const response = await chrome.runtime.sendMessage({
      type: "MANUAL_CREATE_BID_FROM_URL",
      url
    });
    if (!response?.ok) {
      throw new Error(response?.error || "Manual URL run failed.");
    }

    if (response.project) {
      currentProject = response.project;
      projectDataEl.textContent = JSON.stringify(currentProject, null, 2);
      draftBtn.disabled = false;
    }
    if (response.draft) {
      draftOutputEl.value = response.draft;
    }
    setStatus(response.submitClicked ? "Bid created and submitted." : "Bid created (not submitted).");
  } catch (error) {
    console.error(error);
    setStatus(`Manual run failed: ${error.message}`);
  }
});

startAutoBtn.addEventListener("click", async () => {
  try {
    await saveSettings();
    const response = await chrome.runtime.sendMessage({ type: "AUTOMATION_START" });
    if (!response?.ok) {
      throw new Error(response?.error || "Failed to start automation.");
    }
    autoStatusEl.textContent = "Auto mode is on. Polling server queue.";
    setStatus("Automation started.");
  } catch (error) {
    console.error(error);
    setStatus("Could not start automation.");
  }
});

stopAutoBtn.addEventListener("click", async () => {
  try {
    const response = await chrome.runtime.sendMessage({ type: "AUTOMATION_STOP" });
    if (!response?.ok) {
      throw new Error(response?.error || "Failed to stop automation.");
    }
    autoStatusEl.textContent = "Auto mode is off.";
    setStatus("Automation stopped.");
  } catch (error) {
    console.error(error);
    setStatus("Could not stop automation.");
  }
});

runNowBtn.addEventListener("click", async () => {
  try {
    await saveSettings();
    const response = await chrome.runtime.sendMessage({ type: "AUTOMATION_RUN_NOW" });
    if (!response?.ok) {
      throw new Error(response?.error || "Run-now failed.");
    }
    setStatus("Manual automation tick completed.");
  } catch (error) {
    console.error(error);
    setStatus("Manual run failed.");
  }
});

loadSettings().catch((error) => {
  console.error(error);
  setStatus("Could not load saved settings.");
});
