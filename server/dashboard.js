module.exports = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Bid Bot Dashboard</title>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
  <link rel="icon" href="/favicon.ico" sizes="16x16 32x32 48x48" />
  <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
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
    header { display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #2c2f44; margin-bottom: 8px; }
    nav button { margin: 0 0 -1px 6px; border-radius: 6px 6px 0 0; background: transparent; color: #c7c9d9; border-bottom: 2px solid transparent; }
    nav button.active { color: #fff; border-bottom-color: #4b7bff; }
    .tab { display: none; }
    .tab.active { display: block; }
    .stats { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; margin-top: 12px; }
    .stat { background: #171a27; border: 1px solid #2c2f44; border-radius: 8px; padding: 10px 12px; }
    .stat .value { font-size: 22px; font-weight: bold; }
    .stat .label { font-size: 11px; color: #8a8ea8; margin-top: 2px; }
    .outcome-submitted { color: #5fd37a; }
    .outcome-filled { color: #8fb0ff; }
    .outcome-failed { color: #ff6b6b; }
    nav button.logout { margin-left: 18px; border-bottom: 0; color: #8a8ea8; }
    .banner { background: #3a2a12; border: 1px solid #8a5a1a; color: #ffc857; border-radius: 8px; padding: 10px 12px; font-size: 12px; margin: 8px 0 4px; }
    .banner code { color: #fff; }
    .inline { display: flex; gap: 6px; align-items: center; }
    .inline button { margin: 0; white-space: nowrap; }
    #modelCustom { margin-top: 6px; }
  </style>
</head>
<body>
  <header>
    <h1>Bid Bot</h1>
    <nav>
      <button type="button" data-tab="dashboard">Dashboard</button>
      <button type="button" data-tab="settings">Settings</button>
      <button type="button" id="logoutBtn" class="logout" hidden>Log out</button>
    </nav>
  </header>
  <div class="banner" id="authWarning" hidden>
    This dashboard has no password. Anyone with the URL can queue bids and read your AI key.
    Set a <code>DASHBOARD_PASSWORD</code> environment variable in Vercel (or .env) and redeploy to require a login.
  </div>

  <section id="tab-dashboard" class="tab">
  <div class="stats" id="stats"></div>
  <div class="hint">Counts cover the last 100 tasks. Refreshes every 10 seconds.</div>

  <h2>Queue projects</h2>
  <label for="workerId">Worker ID</label>
  <input id="workerId" list="workerList" placeholder="acc-1" />
  <datalist id="workerList"></datalist>
  <label for="urls">Freelancer project URLs (one per line)</label>
  <textarea id="urls" rows="4" placeholder="https://www.freelancer.com/projects/..."></textarea>
  <button id="queueBtn" type="button">Create bids and queue</button>
  <p class="message" id="queueMessage"></p>

  <h2>Working results</h2>
  <table>
    <thead><tr><th>Time</th><th>Worker</th><th>Project</th><th>Outcome</th><th>Details</th></tr></thead>
    <tbody id="resultsBody"></tbody>
  </table>

  <h2>Workers</h2>
  <table>
    <thead><tr><th>Worker</th><th>Status</th><th>Last seen</th></tr></thead>
    <tbody id="workersBody"></tbody>
  </table>

  <h2>Tasks</h2>
  <table>
    <thead><tr><th>Created</th><th>Worker</th><th>Project</th><th>Bid</th><th>Status</th><th>Attempts</th><th>Result</th><th></th></tr></thead>
    <tbody id="tasksBody"></tbody>
  </table>
  </section>

  <section id="tab-settings" class="tab">
  <h2>AI settings</h2>
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
      <div class="inline">
        <select id="model"></select>
        <button id="loadModelsBtn" type="button" class="secondary">Load models</button>
      </div>
      <input id="modelCustom" placeholder="Type the model name" hidden />
      <div class="hint" id="modelStatus"></div>
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
  <button id="testKeyBtn" type="button" class="secondary">Test API key</button>
  <button id="clearKeyBtn" type="button" class="secondary">Remove API key</button>
  <p class="message" id="settingsMessage"></p>
  <p class="message" id="testMessage"></p>
  </section>

  <script>
    const $ = (id) => document.getElementById(id);
    const ONLINE_WINDOW_MS = 90 * 1000;
    let defaultModels = {};
    let savedSettings = {};
    let loadedModels = [];
    let modelsRequestId = 0;

    $("workerId").value = localStorage.getItem("bidbotWorkerId") || "";

    async function api(path, options = {}) {
      const response = await fetch(path, { ...options, headers: { "Content-Type": "application/json" } });
      if (response.status === 401) {
        location.replace("/login");
        throw new Error("Login required");
      }
      const payload = await response.json().catch(() => ({ error: "Server returned an unreadable response (" + response.status + ")" }));
      if (!response.ok) throw new Error(payload.error || response.status);
      return payload;
    }

    async function loadSession() {
      try {
        const session = await api("/api/session");
        $("logoutBtn").hidden = !session.passwordEnabled;
        $("authWarning").hidden = session.passwordEnabled;
      } catch (_error) {
        // Not critical; the page still works without session info.
      }
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
      savedSettings = settings;
      defaultModels = settings.defaultModels || {};
      $("provider").value = settings.provider;
      $("baseUrl").value = settings.baseUrl;
      $("prompt").value = settings.prompt;
      $("apiKey").value = "";
      $("apiKeyStatus").textContent = settings.apiKeySet ? "Saved key ending " + settings.apiKeyHint : "No key saved";
      $("placeholderHint").textContent =
        "Placeholders filled from the project: " + settings.placeholders.map((name) => "{" + name + "}").join(" ");
      renderModelOptions(settings.model);
      loadModelsIfPossible();
    }

    function addModelOption(value, text) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = text;
      $("model").appendChild(option);
    }

    function renderModelOptions(selected) {
      const fallback = defaultModels[$("provider").value];
      $("model").textContent = "";
      addModelOption("", fallback ? "Provider default (" + fallback + ")" : "Provider default");
      for (const model of loadedModels) {
        addModelOption(model.id, model.label ? model.label + " - " + model.id : model.id);
      }
      const known = !selected || loadedModels.some((model) => model.id === selected);
      if (!known) addModelOption(selected, selected + (selected === savedSettings.model ? " (saved)" : " (current)"));
      addModelOption("__custom__", "Custom model...");
      $("model").value = selected || "";
      toggleCustomModel();
    }

    function toggleCustomModel() {
      $("modelCustom").hidden = $("model").value !== "__custom__";
    }

    function modelValue() {
      return $("model").value === "__custom__" ? $("modelCustom").value.trim() : $("model").value;
    }

    function customModelMissing(messageEl) {
      if ($("model").value !== "__custom__" || $("modelCustom").value.trim()) return false;
      messageEl.className = "message outcome-failed";
      messageEl.textContent = "Type the custom model name, or pick a model from the list.";
      $("modelCustom").focus();
      return true;
    }

    function canLoadModels() {
      const provider = $("provider").value;
      if (!provider) return false;
      return Boolean($("apiKey").value.trim()) || (savedSettings.apiKeySet && savedSettings.provider === provider);
    }

    function loadModelsIfPossible() {
      if (canLoadModels()) {
        loadModels();
      } else {
        $("modelStatus").className = "hint";
        $("modelStatus").textContent = $("provider").value
          ? "Paste an API key to load the model list."
          : "Select a provider first.";
      }
    }

    async function loadModels() {
      const requestId = ++modelsRequestId;
      const status = $("modelStatus");
      status.className = "hint";
      status.textContent = "Loading models...";
      $("loadModelsBtn").disabled = true;
      const current = modelValue();
      try {
        const result = await api("/api/settings/models", {
          method: "POST",
          body: JSON.stringify({ provider: $("provider").value, apiKey: $("apiKey").value, baseUrl: $("baseUrl").value })
        });
        if (requestId !== modelsRequestId) return;
        loadedModels = result.ok ? result.models : [];
        renderModelOptions(current);
        if (result.ok) {
          status.textContent = loadedModels.length + " models available for this key.";
        } else {
          status.className = "hint outcome-failed";
          status.textContent = "Could not load models: " + result.error;
        }
      } catch (error) {
        if (requestId !== modelsRequestId) return;
        status.className = "hint outcome-failed";
        status.textContent = "Could not load models: " + error.message;
      } finally {
        if (requestId === modelsRequestId) $("loadModelsBtn").disabled = false;
      }
    }

    async function loadSettings() {
      try {
        showSettings((await api("/api/settings")).settings);
      } catch (error) {
        $("settingsMessage").textContent = "Could not load settings: " + error.message;
      }
    }

    async function saveSettings(extra = {}) {
      if (!extra.clearApiKey && customModelMissing($("settingsMessage"))) return;
      $("settingsMessage").className = "message";
      try {
        const payload = await api("/api/settings", {
          method: "PUT",
          body: JSON.stringify({
            provider: $("provider").value,
            apiKey: $("apiKey").value,
            model: modelValue(),
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

    function renderProjectCell(row, title, url) {
      const td = cell(row, "", "project");
      const titleEl = document.createElement("div");
      titleEl.textContent = title || "(title unknown)";
      const link = document.createElement("a");
      link.href = url;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = url;
      td.append(titleEl, link);
    }

    function outcomeOf(status, details) {
      if (status !== "success") return { text: "Failed", className: "outcome-failed" };
      if (details && details.submitClicked) return { text: "Submitted", className: "outcome-submitted" };
      return { text: "Filled, not submitted", className: "outcome-filled" };
    }

    function renderStats(tasks) {
      const counts = { queued: 0, dispatched: 0, submitted: 0, filled: 0, failed: 0 };
      for (const task of tasks) {
        if (task.status === "done") {
          counts[task.result && task.result.submitClicked ? "submitted" : "filled"] += 1;
        } else if (counts[task.status] !== undefined) {
          counts[task.status] += 1;
        }
      }
      const cards = [
        ["Queued", counts.queued],
        ["In progress", counts.dispatched],
        ["Submitted", counts.submitted, "outcome-submitted"],
        ["Filled, not submitted", counts.filled, "outcome-filled"],
        ["Failed", counts.failed, "outcome-failed"]
      ];
      $("stats").replaceChildren(
        ...cards.map(([label, value, className]) => {
          const card = document.createElement("div");
          card.className = "stat";
          const valueEl = document.createElement("div");
          valueEl.className = "value " + (className || "");
          valueEl.textContent = value;
          const labelEl = document.createElement("div");
          labelEl.className = "label";
          labelEl.textContent = label;
          card.append(valueEl, labelEl);
          return card;
        })
      );
    }

    function renderResults(results) {
      $("resultsBody").replaceChildren();
      if (!results.length) {
        const row = document.createElement("tr");
        cell(row, "No results yet. They appear here as workers finish tasks.").colSpan = 5;
        $("resultsBody").appendChild(row);
        return;
      }
      for (const result of results.slice(0, 50)) {
        const row = document.createElement("tr");
        const outcome = outcomeOf(result.status, result.details);
        cell(row, formatTime(result.at));
        cell(row, result.workerId);
        renderProjectCell(row, result.title, result.url);
        cell(row, outcome.text, outcome.className);
        cell(row, (result.details && result.details.error) || "");
        $("resultsBody").appendChild(row);
      }
    }

    function showTab(name) {
      const tab = name === "settings" ? "settings" : "dashboard";
      document.querySelectorAll(".tab").forEach((el) => el.classList.toggle("active", el.id === "tab-" + tab));
      document.querySelectorAll("nav button").forEach((el) => el.classList.toggle("active", el.dataset.tab === tab));
      if (location.hash.slice(1) !== tab) history.replaceState(null, "", "#" + tab);
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
        renderProjectCell(row, task.project && task.project.title, task.url);
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
        const [workers, tasks, results] = await Promise.all([
          api("/api/workers"),
          api("/api/tasks"),
          api("/api/results")
        ]);
        renderWorkers(workers.workers);
        renderStats(tasks.tasks);
        renderResults(results.results);
        renderTasks(tasks.tasks);
      } catch (error) {
        $("queueMessage").textContent = "Refresh failed: " + error.message;
      }
    }

    $("provider").addEventListener("change", () => {
      loadedModels = [];
      renderModelOptions("");
      loadModelsIfPossible();
    });
    $("apiKey").addEventListener("change", loadModelsIfPossible);
    $("model").addEventListener("change", toggleCustomModel);
    $("loadModelsBtn").addEventListener("click", loadModels);
    $("saveSettingsBtn").addEventListener("click", () => saveSettings());
    $("clearKeyBtn").addEventListener("click", () => saveSettings({ apiKey: "", clearApiKey: true }));

    $("testKeyBtn").addEventListener("click", async () => {
      const message = $("testMessage");
      if (customModelMissing(message)) return;
      $("testKeyBtn").disabled = true;
      message.className = "message";
      message.textContent = "Testing API key...";
      try {
        const result = await api("/api/settings/test", {
          method: "POST",
          body: JSON.stringify({
            provider: $("provider").value,
            apiKey: $("apiKey").value,
            model: modelValue(),
            baseUrl: $("baseUrl").value
          })
        });
        if (result.ok) {
          message.className = "message outcome-submitted";
          message.textContent =
            "API key works. Model " + result.model + " answered in " + result.latencyMs + " ms: \\"" + result.reply + "\\"";
        } else {
          message.className = "message outcome-failed";
          message.textContent = "API key check failed: " + result.error;
        }
      } catch (error) {
        message.className = "message outcome-failed";
        message.textContent = "API key check failed: " + error.message;
      } finally {
        $("testKeyBtn").disabled = false;
      }
    });

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

    document.querySelectorAll("nav button").forEach((button) => {
      button.addEventListener("click", () => showTab(button.dataset.tab));
    });
    window.addEventListener("hashchange", () => showTab(location.hash.slice(1)));

    $("logoutBtn").addEventListener("click", async () => {
      await api("/api/logout", { method: "POST" }).catch(() => {});
      location.replace("/login");
    });

    showTab(location.hash.slice(1));
    loadSession();
    loadSettings();
    refresh();
    setInterval(refresh, 10000);
  </script>
</body>
</html>`;
