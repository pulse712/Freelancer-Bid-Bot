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
    h1 { font-size: 20px; margin: 0; }
    h2 { font-size: 15px; margin-top: 28px; }
    input, textarea, select { width: 100%; box-sizing: border-box; padding: 8px; background: #171a27; color: #e8ebff; border: 1px solid #2c2f44; border-radius: 6px; font-family: inherit; }
    label { display: block; margin: 10px 0 4px; font-size: 12px; color: #c7c9d9; }
    button { margin-top: 10px; margin-right: 6px; padding: 8px 12px; border: 0; border-radius: 6px; background: #4b7bff; color: #fff; cursor: pointer; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th, td { text-align: left; padding: 6px; border-bottom: 1px solid #2c2f44; vertical-align: top; }
    td.project { max-width: 340px; word-break: break-word; }
    td.project a { color: #8fb0ff; font-size: 11px; }
    pre { white-space: pre-wrap; background: #171a27; padding: 8px; border-radius: 6px; margin: 6px 0 0; max-width: 420px; }
    .hint { font-size: 11px; color: #8a8ea8; }
    .online, .status-done { color: #5fd37a; }
    .offline { color: #999; }
    .status-failed { color: #ff6b6b; }
    .status-dispatched { color: #ffc857; }
    .message { font-size: 12px; color: #c7c9d9; }
    header { display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #2c2f44; margin-bottom: 8px; padding-bottom: 8px; }
    .logout { margin: 0; background: #2f3244; color: #c7c9d9; }
    .stats { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; margin-top: 12px; }
    .stat { background: #171a27; border: 1px solid #2c2f44; border-radius: 8px; padding: 10px 12px; }
    .stat .value { font-size: 22px; font-weight: bold; }
    .stat .label { font-size: 11px; color: #8a8ea8; margin-top: 2px; }
    .outcome-submitted { color: #5fd37a; }
    .outcome-filled { color: #8fb0ff; }
    .outcome-failed { color: #ff6b6b; }
    .add-row { display: grid; grid-template-columns: 1fr 1fr auto; gap: 8px; align-items: end; margin: 8px 0 12px; }
    .add-row label { margin: 0 0 4px; }
    .add-row input { margin: 0; }
    .add-row button { margin: 0; }
    .send-row { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
    .send-row button { margin: 0; }
    button.danger { background: #2f3244; color: #ff6b6b; }
    button:disabled { opacity: 0.55; cursor: default; }
    .worker-name { font-weight: bold; }
    .worker-id { font-size: 11px; color: #8a8ea8; }
  </style>
</head>
<body>
  <header>
    <h1>Bid Bot</h1>
    <button type="button" id="logoutBtn" class="logout" hidden>Log out</button>
  </header>

  <div class="stats" id="stats"></div>
  <div class="hint">Counts cover the last 100 tasks. Refreshes every 10 seconds.</div>

  <h2>Workers</h2>
  <p class="hint">Add each extension once. The Worker ID must match the ID in that extension. Then send URLs with the worker's button.</p>
  <div class="add-row">
    <div>
      <label for="newWorkerName">Name</label>
      <input id="newWorkerName" placeholder="e.g. John" />
    </div>
    <div>
      <label for="newWorkerId">Worker ID</label>
      <input id="newWorkerId" placeholder="e.g. acc-1" />
    </div>
    <button id="addWorkerBtn" type="button">Add worker</button>
  </div>
  <p class="message" id="rosterMessage"></p>
  <table>
    <thead><tr><th>Worker</th><th>Status</th><th>Last seen</th><th></th></tr></thead>
    <tbody id="workersBody"></tbody>
  </table>

  <h2>Send projects</h2>
  <p class="hint">Paste URLs, then click a worker button. That extension opens each project and bids if Auto is on.</p>
  <label for="urls">Freelancer project URLs (one per line)</label>
  <textarea id="urls" rows="4" placeholder="https://www.freelancer.com/projects/..."></textarea>
  <div class="send-row" id="sendButtons"></div>
  <p class="message" id="queueMessage"></p>

  <h2>Working results</h2>
  <table>
    <thead><tr><th>Time</th><th>Worker</th><th>Project</th><th>Outcome</th><th>Details</th></tr></thead>
    <tbody id="resultsBody"></tbody>
  </table>

  <h2>Tasks</h2>
  <table>
    <thead><tr><th>Created</th><th>Worker</th><th>Project</th><th>Bid</th><th>Status</th><th>Attempts</th><th>Result</th><th></th></tr></thead>
    <tbody id="tasksBody"></tbody>
  </table>

  <script>
    const $ = (id) => document.getElementById(id);
    const ONLINE_WINDOW_MS = 90 * 1000;
    let roster = [];

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

    function describeResult(task) {
      if (task.result && task.result.error) return task.result.error;
      if (task.result) return task.result.submitClicked ? "Submitted" : "Filled, not submitted";
      return task.note || "";
    }

    function workerLabel(workerId) {
      const match = roster.find((item) => item.workerId === workerId);
      return match ? match.name + " (" + match.workerId + ")" : workerId;
    }

    function renderSendButtons() {
      const row = $("sendButtons");
      row.replaceChildren();
      if (!roster.length) {
        const hint = document.createElement("p");
        hint.className = "hint";
        hint.textContent = "Add a worker above, then a Send button appears here.";
        hint.style.margin = "0";
        row.appendChild(hint);
        return;
      }
      for (const worker of roster) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = "Send to " + worker.name;
        button.addEventListener("click", () => sendUrlsToWorker(worker));
        row.appendChild(button);
      }
    }

    function renderWorkers(workers) {
      roster = workers;
      $("workersBody").replaceChildren();
      renderSendButtons();
      if (!workers.length) {
        const row = document.createElement("tr");
        cell(row, "No workers yet. Add a name and Worker ID above.").colSpan = 4;
        $("workersBody").appendChild(row);
        return;
      }
      for (const worker of workers) {
        const online = worker.lastSeen && Date.now() - Date.parse(worker.lastSeen) < ONLINE_WINDOW_MS;
        const row = document.createElement("tr");
        const nameCell = cell(row, "");
        const nameEl = document.createElement("div");
        nameEl.className = "worker-name";
        nameEl.textContent = worker.name;
        const idEl = document.createElement("div");
        idEl.className = "worker-id";
        idEl.textContent = worker.workerId;
        nameCell.append(nameEl, idEl);
        cell(row, online ? "online" : "offline", online ? "online" : "offline");
        cell(row, formatTime(worker.lastSeen));
        const actions = cell(row, "");
        const send = document.createElement("button");
        send.type = "button";
        send.textContent = "Send URLs";
        send.addEventListener("click", () => sendUrlsToWorker(worker));
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "danger";
        remove.textContent = "Remove";
        remove.addEventListener("click", () => removeWorker(worker));
        actions.append(send, remove);
        $("workersBody").appendChild(row);
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
        cell(row, workerLabel(result.workerId));
        renderProjectCell(row, result.title, result.url);
        cell(row, outcome.text, outcome.className);
        cell(row, (result.details && result.details.error) || "");
        $("resultsBody").appendChild(row);
      }
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
        cell(row, workerLabel(task.workerId));
        renderProjectCell(row, task.project && task.project.title, task.url);
        renderBidCell(row, task);
        cell(row, task.status, "status-" + task.status);
        cell(row, task.attempts || 0);
        cell(row, describeResult(task));
        const actions = cell(row, "");
        if (task.status === "failed" || task.status === "done") {
          const retry = document.createElement("button");
          retry.textContent = "Retry";
          retry.title = "Queue this project again for the worker";
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

    async function sendUrlsToWorker(worker) {
      const urls = $("urls").value.split("\\n").map((line) => line.trim()).filter(Boolean);
      if (!urls.length) {
        $("queueMessage").textContent = "Paste at least one Freelancer URL first.";
        return;
      }
      $("queueMessage").textContent = "Sending URLs to " + worker.name + "...";
      document.querySelectorAll(".send-row button, #workersBody button").forEach((button) => {
        button.disabled = true;
      });
      try {
        const { tasks } = await api("/api/tasks", { method: "POST", body: JSON.stringify({ workerId: worker.workerId, urls }) });
        const failed = tasks.filter((task) => task.status === "failed").length;
        $("queueMessage").textContent =
          "Sent " + (tasks.length - failed) + " of " + tasks.length + " URL(s) to " + worker.name + "." +
          (failed ? " " + failed + " failed - see Result column." : " The extension will bid when Auto is on.");
        $("urls").value = "";
        refresh();
      } catch (error) {
        $("queueMessage").textContent = "Send failed: " + error.message;
      } finally {
        document.querySelectorAll(".send-row button, #workersBody button").forEach((button) => {
          button.disabled = false;
        });
      }
    }

    async function removeWorker(worker) {
      try {
        const payload = await api("/api/workers/" + encodeURIComponent(worker.workerId), { method: "DELETE" });
        renderWorkers(payload.workers);
        $("rosterMessage").textContent = "Removed " + worker.name + ".";
      } catch (error) {
        $("rosterMessage").textContent = "Could not remove worker: " + error.message;
      }
    }

    $("addWorkerBtn").addEventListener("click", async () => {
      const name = $("newWorkerName").value.trim();
      const workerId = $("newWorkerId").value.trim();
      if (!workerId) {
        $("rosterMessage").textContent = "Enter a Worker ID that matches the extension.";
        return;
      }
      $("addWorkerBtn").disabled = true;
      try {
        const payload = await api("/api/workers", { method: "POST", body: JSON.stringify({ name, workerId }) });
        renderWorkers(payload.workers);
        $("newWorkerName").value = "";
        $("newWorkerId").value = "";
        $("rosterMessage").textContent = "Added " + (name || workerId) + ". Use its Send button after you paste URLs.";
      } catch (error) {
        $("rosterMessage").textContent = "Could not add worker: " + error.message;
      } finally {
        $("addWorkerBtn").disabled = false;
      }
    });

    $("newWorkerId").addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        $("addWorkerBtn").click();
      }
    });

    $("logoutBtn").addEventListener("click", async () => {
      await api("/api/logout", { method: "POST" }).catch(() => {});
      location.replace("/login");
    });

    loadSession();
    refresh();
    setInterval(refresh, 10000);
  </script>
</body>
</html>`;
