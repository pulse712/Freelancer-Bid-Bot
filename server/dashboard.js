module.exports = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Bid Bot Dashboard</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 24px auto; max-width: 1100px; padding: 0 12px; background: #10111a; color: #e8ebff; }
    h1 { font-size: 20px; }
    h2 { font-size: 15px; margin-top: 28px; }
    input, textarea { width: 100%; box-sizing: border-box; padding: 8px; background: #171a27; color: #e8ebff; border: 1px solid #2c2f44; border-radius: 6px; }
    label { display: block; margin: 10px 0 4px; font-size: 12px; color: #c7c9d9; }
    button { margin-top: 10px; padding: 8px 12px; border: 0; border-radius: 6px; background: #4b7bff; color: #fff; cursor: pointer; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th, td { text-align: left; padding: 6px; border-bottom: 1px solid #2c2f44; vertical-align: top; }
    td.url { max-width: 320px; word-break: break-all; }
    .online { color: #5fd37a; }
    .offline { color: #999; }
    .status-done { color: #5fd37a; }
    .status-failed { color: #ff6b6b; }
    .status-dispatched { color: #ffc857; }
    #message { font-size: 12px; color: #c7c9d9; }
  </style>
</head>
<body>
  <h1>Bid Bot Dashboard</h1>

  <h2>Queue projects</h2>
  <label for="workerId">Worker ID</label>
  <input id="workerId" list="workerList" placeholder="acc-1" />
  <datalist id="workerList"></datalist>
  <label for="urls">Freelancer project URLs (one per line)</label>
  <textarea id="urls" rows="4" placeholder="https://www.freelancer.com/projects/..."></textarea>
  <button id="queueBtn" type="button">Queue</button>
  <p id="message"></p>

  <h2>Workers</h2>
  <table>
    <thead><tr><th>Worker</th><th>Status</th><th>Last seen</th></tr></thead>
    <tbody id="workersBody"></tbody>
  </table>

  <h2>Recent tasks</h2>
  <table>
    <thead><tr><th>Created</th><th>Worker</th><th>URL</th><th>Status</th><th>Attempts</th><th>Result</th><th></th></tr></thead>
    <tbody id="tasksBody"></tbody>
  </table>

  <script>
    const workerIdEl = document.getElementById("workerId");
    const urlsEl = document.getElementById("urls");
    const messageEl = document.getElementById("message");
    const ONLINE_WINDOW_MS = 90 * 1000;

    workerIdEl.value = localStorage.getItem("bidbotWorkerId") || "";

    async function api(path, options = {}) {
      const response = await fetch(path, {
        ...options,
        headers: { "Content-Type": "application/json" }
      });
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

    function describeResult(task) {
      if (!task.result) return "";
      if (task.result.error) return task.result.error;
      return task.result.submitClicked ? "Submitted" : "Filled, not submitted";
    }

    function renderWorkers(workers) {
      const body = document.getElementById("workersBody");
      const list = document.getElementById("workerList");
      body.replaceChildren();
      list.replaceChildren();
      for (const worker of workers) {
        const online = Date.now() - Date.parse(worker.lastSeen) < ONLINE_WINDOW_MS;
        const row = document.createElement("tr");
        cell(row, worker.workerId);
        cell(row, online ? "online" : "offline", online ? "online" : "offline");
        cell(row, formatTime(worker.lastSeen));
        body.appendChild(row);
        const option = document.createElement("option");
        option.value = worker.workerId;
        list.appendChild(option);
      }
    }

    function renderTasks(tasks) {
      const body = document.getElementById("tasksBody");
      body.replaceChildren();
      for (const task of tasks) {
        const row = document.createElement("tr");
        cell(row, formatTime(task.createdAt));
        cell(row, task.workerId);
        cell(row, task.url, "url");
        cell(row, task.status, "status-" + task.status);
        cell(row, task.attempts || 0);
        cell(row, describeResult(task));
        const actions = cell(row, "");
        if (task.status === "failed" || task.status === "done") {
          const retry = document.createElement("button");
          retry.textContent = "Retry";
          retry.addEventListener("click", async () => {
            await api("/api/tasks/" + encodeURIComponent(task.id) + "/retry", { method: "POST" });
            refresh();
          });
          actions.appendChild(retry);
        }
        body.appendChild(row);
      }
    }

    async function refresh() {
      try {
        const [workers, tasks] = await Promise.all([api("/api/workers"), api("/api/tasks")]);
        renderWorkers(workers.workers);
        renderTasks(tasks.tasks);
      } catch (error) {
        messageEl.textContent = "Refresh failed: " + error.message;
      }
    }

    document.getElementById("queueBtn").addEventListener("click", async () => {
      const workerId = workerIdEl.value.trim();
      const urls = urlsEl.value.split("\\n").map((line) => line.trim()).filter(Boolean);
      localStorage.setItem("bidbotWorkerId", workerId);
      try {
        const payload = await api("/api/tasks", {
          method: "POST",
          body: JSON.stringify({ workerId, urls })
        });
        messageEl.textContent = "Queued " + payload.tasks.length + " task(s).";
        urlsEl.value = "";
        refresh();
      } catch (error) {
        messageEl.textContent = "Queue failed: " + error.message;
      }
    });

    refresh();
    setInterval(refresh, 10000);
  </script>
</body>
</html>`;
