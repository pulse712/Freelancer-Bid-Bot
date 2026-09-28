module.exports = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Bid Bot Dashboard</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 24px auto; max-width: 1100px; padding: 0 12px; background: #10111a; color: #e8ebff; }
    h1 { font-size: 20px; }
    h2 { font-size: 15px; margin-top: 28px; }
    input, textarea, select { width: 100%; box-sizing: border-box; padding: 8px; background: #171a27; color: #e8ebff; border: 1px solid #2c2f44; border-radius: 6px; font-family: inherit; }
    label { display: block; margin: 10px 0 4px; font-size: 12px; color: #c7c9d9; }
    button { margin-top: 10px; margin-right: 6px; padding: 8px 12px; border: 0; border-radius: 6px; background: #4b7bff; color: #fff; cursor: pointer; }
    button.secondary { background: #2f3244; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th, td { text-align: left; padding: 6px; border-bottom: 1px solid #2c2f44; vertical-align: top; }
    td.project { max-width: 340px; word-break: break-word; }
    td.project a { color: #8fb0ff; font-size: 11px; }
    pre { white-space: pre-wrap; background: #171a27; padding: 8px; border-radius: 6px; margin: 6px 0 0; max-width: 420px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 16px; }
    .hint { font-size: 11px; color: #8a8ea8; }
    .online, .status-done { color: #5fd37a; }
    .offline { color: #999; }
    .status-failed { color: #ff6b6b; }
    .status-dispatched { color: #ffc857; }
    .message { font-size: 12px; color: #c7c9d9; }
  </style>
</head>
<body>
  <h1>Bid Bot Dashboard</h1>

  <h2>Settings</h2>
  <div class="grid">
    <div>
      <label for="provider">AI provider</label>
      <select id="provider">
        <option value="">Select provider</option>
        <option value="openai">OpenAI</option>
        <option value="claude">Claude (Anthropic)</option>
        <option value="gemini">Gemini (Google)</option>
        <option value="cursor">OpenAI-compatible (Cursor, OpenRouter, ...)</option>
      </select>
    </div>
    <div>
      <label for="apiKey">API key</label>
      <input id="apiKey" type="password" placeholder="Paste to set or replace" autocomplete="off" />
      <div class="hint" id="apiKeyStatus"></div>
    </div>
    <div>
      <label for="model">Model</label>
      <input id="model" placeholder="Leave blank for the provider default" />
    </div>
    <div>
      <label for="baseUrl">Base URL (optional)</label>
      <input id="baseUrl" placeholder="Only for custom or OpenAI-compatible endpoints" />
    </div>
  </div>
  <label for="prompt">Bid prompt</label>
  <textarea id="prompt" rows="12"></textarea>
  <div class="hint" id="placeholderHint"></div>
  <button id="saveSettingsBtn" type="button">Save settings</button>
  <button id="clearKeyBtn" type="button" class="secondary">Remove API key</button>
  <p class="message" id="settingsMessage"></p>

  <h2>Queue projects</h2>
  <label for="workerId">Worker ID</label>
  <input id="workerId" list="workerList" placeholder="acc-1" />
  <datalist id="workerList"></datalist>
  <label for="urls">Freelancer project URLs (one per line)</label>
  <textarea id="urls" rows="4" placeholder="https://www.freelancer.com/projects/..."></textarea>
  <button id="queueBtn" type="button">Create bids and queue</button>
  <p class="message" id="queueMessage"></p>

  <h2>Workers</h2>
  <table>
    <thead><tr><th>Worker</th><th>Status</th><th>Last seen</th></tr></thead>
    <tbody id="workersBody"></tbody>
  </table>

  <h2>Recent tasks</h2>
  <table>
    <thead><tr><th>Created</th><th>Worker</th><th>Project</th><th>Bid</th><th>Status</th><th>Attempts</th><th>Result</th><th></th></tr></thead>
    <tbody id="tasksBody"></tbody>
  </table>

  <script>
    const $ = (id) => document.getElementById(id);
    const ONLINE_WINDOW_MS = 90 * 1000;
    let defaultModels = {};

    $("workerId").value = localStorage.getItem("bidbotWorkerId") || "";

    async function api(path, options = {}) {
      const response = await fetch(path, { ...options, headers: { "Content-Type": "application/json" } });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || response.status);
      return payload;
    }

    function cell(row, text, className) {
      const td = document.createElement("td");
      td.textContent = text == null ? "" : String(text);
      if (className) td.className = className;
      row.appendChild(td);
      return td;
    }

    function formatTime(iso) {
      return iso ? new Date(iso).toLocaleString() : "-";
    }

    function showSettings(settings) {
      defaultModels = settings.defaultModels || {};
      $("provider").value = settings.provider;
      $("model").value = settings.model;
      $("baseUrl").value = settings.baseUrl;
      $("prompt").value = settings.prompt;
      $("apiKey").value = "";
      $("apiKeyStatus").textContent = settings.apiKeySet ? "Saved key ending " + settings.apiKeyHint : "No key saved";
      $("placeholderHint").textContent =
        "Placeholders filled from the project: " + settings.placeholders.map((name) => "{" + name + "}").join(" ");
      updateModelPlaceholder();
    }

    function updateModelPlaceholder() {
      const fallback = defaultModels[$("provider").value];
      $("model").placeholder = fallback ? "Default: " + fallback : "Leave blank for the provider default";
    }

    async function loadSettings() {
      try {
        showSettings((await api("/api/settings")).settings);
      } catch (error) {
        $("settingsMessage").textContent = "Could not load settings: " + error.message;
      }
    }

    async function saveSettings(extra = {}) {
      try {
        const payload = await api("/api/settings", {
          method: "PUT",
          body: JSON.stringify({
            provider: $("provider").value,
            apiKey: $("apiKey").value,
            model: $("model").value,
            baseUrl: $("baseUrl").value,
            prompt: $("prompt").value,
            ...extra
          })
        });
        showSettings(payload.settings);
        $("settingsMessage").textContent = "Settings saved.";
      } catch (error) {
        $("settingsMessage").textContent = "Save failed: " + error.message;
      }
    }

    function describeResult(task) {
      if (task.result && task.result.error) return task.result.error;
      if (task.result) return task.result.submitClicked ? "Submitted" : "Filled, not submitted";
      return task.note || "";
    }

    function renderWorkers(workers) {
      $("workersBody").replaceChildren();
      $("workerList").replaceChildren();
      for (const worker of workers) {
        const online = Date.now() - Date.parse(worker.lastSeen) < ONLINE_WINDOW_MS;
        const row = document.createElement("tr");
        cell(row, worker.workerId);
        cell(row, online ? "online" : "offline", online ? "online" : "offline");
        cell(row, formatTime(worker.lastSeen));
        $("workersBody").appendChild(row);
        const option = document.createElement("option");
        option.value = worker.workerId;
        $("workerList").appendChild(option);
      }
    }

    function renderProjectCell(row, task) {
      const td = cell(row, "", "project");
      const title = document.createElement("div");
      title.textContent = (task.project && task.project.title) || "(title unknown)";
      const link = document.createElement("a");
      link.href = task.url;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = task.url;
      td.append(title, link);
    }

    function renderBidCell(row, task) {
      const td = cell(row, task.draft ? "" : "-");
      if (!task.draft) return;
      const details = document.createElement("details");
      const summary = document.createElement("summary");
      summary.textContent = "View bid";
      const pre = document.createElement("pre");
      pre.textContent = task.draft;
      details.append(summary, pre);
      td.appendChild(details);
    }

    function renderTasks(tasks) {
      $("tasksBody").replaceChildren();
      for (const task of tasks) {
        const row = document.createElement("tr");
        cell(row, formatTime(task.createdAt));
        cell(row, task.workerId);
        renderProjectCell(row, task);
        renderBidCell(row, task);
        cell(row, task.status, "status-" + task.status);
        cell(row, task.attempts || 0);
        cell(row, describeResult(task));
        const actions = cell(row, "");
        if (task.status === "failed" || task.status === "done") {
          const retry = document.createElement("button");
          retry.textContent = "Retry";
          retry.title = "Regenerate the bid with current settings and queue again";
          retry.addEventListener("click", async () => {
            retry.disabled = true;
            await api("/api/tasks/" + encodeURIComponent(task.id) + "/retry", { method: "POST" }).catch(() => {});
            refresh();
          });
          actions.appendChild(retry);
        }
        $("tasksBody").appendChild(row);
      }
    }

    async function refresh() {
      try {
        const [workers, tasks] = await Promise.all([api("/api/workers"), api("/api/tasks")]);
        renderWorkers(workers.workers);
        renderTasks(tasks.tasks);
      } catch (error) {
        $("queueMessage").textContent = "Refresh failed: " + error.message;
      }
    }

    $("provider").addEventListener("change", updateModelPlaceholder);
    $("saveSettingsBtn").addEventListener("click", () => saveSettings());
    $("clearKeyBtn").addEventListener("click", () => saveSettings({ apiKey: "", clearApiKey: true }));

    $("queueBtn").addEventListener("click", async () => {
      const workerId = $("workerId").value.trim();
      const urls = $("urls").value.split("\\n").map((line) => line.trim()).filter(Boolean);
      localStorage.setItem("bidbotWorkerId", workerId);
      $("queueBtn").disabled = true;
      $("queueMessage").textContent = "Fetching projects and writing bids...";
      try {
        const { tasks } = await api("/api/tasks", { method: "POST", body: JSON.stringify({ workerId, urls }) });
        const failed = tasks.filter((task) => task.status === "failed").length;
        $("queueMessage").textContent =
          "Queued " + (tasks.length - failed) + " of " + tasks.length + " task(s)." +
          (failed ? " " + failed + " failed - see Result column." : "");
        $("urls").value = "";
        refresh();
      } catch (error) {
        $("queueMessage").textContent = "Queue failed: " + error.message;
      } finally {
        $("queueBtn").disabled = false;
      }
    });

    loadSettings();
    refresh();
    setInterval(refresh, 10000);
  </script>
</body>
</html>`;
