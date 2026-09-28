const express = require("express");
const cors = require("cors");
require("dotenv").config();

const store = require("./store");
const dashboardHtml = require("./dashboard");
const { generateBid, testConnection, DEFAULT_PROMPT, DEFAULT_MODELS, PLACEHOLDERS } = require("./ai");
const { fetchProject } = require("./freelancer");

const WORKER_TOKEN = process.env.WORKER_TOKEN || "";
const TASK_TIMEOUT_MS = Number(process.env.TASK_TIMEOUT_MS || 5 * 60 * 1000);
const MAX_ATTEMPTS = Number(process.env.MAX_ATTEMPTS || 2);

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

function checkWorker(req, res, next) {
  if (!WORKER_TOKEN || req.headers["x-worker-token"] === WORKER_TOKEN) {
    return next();
  }
  return res.status(401).json({ error: "Unauthorized worker request" });
}

function asyncRoute(handler) {
  return (req, res) => {
    handler(req, res).catch((error) => {
      console.error(error);
      res.status(500).json({ error: error.message });
    });
  };
}

function isFreelancerUrl(url) {
  return /^https?:\/\/(www\.)?freelancer\.com\/.+/i.test(url || "");
}

async function expireStaleTasks(workerId) {
  const inflight = await store.listInflight(workerId);
  for (const task of inflight) {
    if (Date.now() - Date.parse(task.claimedAt) < TASK_TIMEOUT_MS) {
      continue;
    }
    if ((task.attempts || 0) < MAX_ATTEMPTS) {
      await store.requeueTask(task);
    } else {
      await store.finishTask(task, "fail", { error: "Timed out waiting for worker result" });
    }
  }
}

async function prepareTask(task, settings) {
  task.project = null;
  task.draft = null;
  task.note = null;
  task.result = null;
  task.status = "queued";

  try {
    task.project = await fetchProject(task.url);
  } catch (error) {
    task.note = `Project lookup failed (${error.message}); the worker will read the page and request the bid.`;
    return task;
  }

  try {
    task.draft = await generateBid(task.project, settings);
  } catch (error) {
    task.status = "failed";
    task.result = { error: `Bid generation failed: ${error.message}` };
  }
  return task;
}

function publicSettings(settings) {
  return {
    provider: settings.provider || "",
    model: settings.model || "",
    baseUrl: settings.baseUrl || "",
    prompt: settings.prompt || DEFAULT_PROMPT,
    apiKeySet: Boolean(settings.apiKey),
    apiKeyHint: settings.apiKey ? `…${settings.apiKey.slice(-4)}` : "",
    defaultModels: DEFAULT_MODELS,
    placeholders: PLACEHOLDERS
  };
}

app.get("/", (_req, res) => {
  res.type("html").send(dashboardHtml);
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "bid-bot-backend", storage: store.storageKind });
});

app.post(
  "/api/tasks",
  asyncRoute(async (req, res) => {
    const { workerId, url, urls, meta } = req.body || {};
    const list = (Array.isArray(urls) ? urls : [url]).map((item) => String(item || "").trim()).filter(Boolean);

    if (!workerId || !list.length) {
      return res.status(400).json({ error: "workerId and at least one url are required" });
    }
    const invalid = list.filter((item) => !isFreelancerUrl(item));
    if (invalid.length) {
      return res.status(400).json({ error: `Not freelancer.com URLs: ${invalid.join(", ")}` });
    }

    const settings = await store.getSettings();
    const tasks = await Promise.all(
      list.map(async (item) => {
        const task = await prepareTask(
          {
            id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
            workerId,
            url: item,
            type: "create_bid",
            attempts: 0,
            meta: meta || null,
            createdAt: new Date().toISOString(),
            claimedAt: null
          },
          settings
        );
        return store.createTask(task);
      })
    );
    return res.json({ ok: true, tasks });
  })
);

app.get(
  "/api/tasks",
  asyncRoute(async (req, res) => {
    const tasks = await store.listRecentTasks(100);
    const workerId = req.query.workerId;
    return res.json({ tasks: workerId ? tasks.filter((task) => task.workerId === workerId) : tasks });
  })
);

app.post(
  "/api/tasks/:id/retry",
  asyncRoute(async (req, res) => {
    const task = await store.getTask(req.params.id);
    if (!task) {
      return res.status(404).json({ error: "Task not found" });
    }
    if (task.status === "queued" || task.status === "dispatched") {
      return res.status(409).json({ error: `Task is already ${task.status}` });
    }
    task.attempts = 0;
    await prepareTask(task, await store.getSettings());
    if (task.status === "queued") {
      await store.requeueTask(task);
    } else {
      await store.saveTask(task);
    }
    return res.json({ ok: true, task });
  })
);

app.get(
  "/api/results",
  asyncRoute(async (req, res) => {
    const results = await store.listResults(200);
    const workerId = req.query.workerId;
    return res.json({ results: workerId ? results.filter((item) => item.workerId === workerId) : results });
  })
);

app.get(
  "/api/workers",
  asyncRoute(async (_req, res) => {
    return res.json({ workers: await store.listWorkers() });
  })
);

app.get(
  "/api/worker/next-task",
  checkWorker,
  asyncRoute(async (req, res) => {
    const workerId = String(req.query.workerId || "");
    if (!workerId) {
      return res.status(400).json({ error: "workerId query is required" });
    }
    await store.touchWorker(workerId);
    await expireStaleTasks(workerId);
    return res.json({ task: await store.claimNextTask(workerId) });
  })
);

app.post(
  "/api/worker/task-result",
  checkWorker,
  asyncRoute(async (req, res) => {
    const { taskId, workerId, status, details } = req.body || {};
    if (!taskId || !workerId || !["success", "fail"].includes(status)) {
      return res.status(400).json({ error: "taskId, workerId, and status (success|fail) are required" });
    }
    const task = await store.getTask(taskId);
    if (!task || task.workerId !== workerId) {
      return res.status(404).json({ error: "Task not found for this worker" });
    }
    await store.finishTask(task, status, details);
    return res.json({ ok: true });
  })
);

app.get(
  "/api/settings",
  asyncRoute(async (_req, res) => {
    return res.json({ settings: publicSettings(await store.getSettings()) });
  })
);

app.put(
  "/api/settings",
  asyncRoute(async (req, res) => {
    const { provider, apiKey, model, baseUrl, prompt, clearApiKey } = req.body || {};
    const current = await store.getSettings();
    const next = {
      ...current,
      provider: String(provider ?? current.provider ?? "").trim(),
      model: String(model ?? current.model ?? "").trim(),
      baseUrl: String(baseUrl ?? current.baseUrl ?? "").trim(),
      prompt: String(prompt ?? current.prompt ?? "").trim()
    };
    if (clearApiKey) {
      next.apiKey = "";
    } else if (apiKey && String(apiKey).trim()) {
      next.apiKey = String(apiKey).trim();
    }
    await store.saveSettings(next);
    return res.json({ ok: true, settings: publicSettings(next) });
  })
);

app.post(
  "/api/settings/test",
  asyncRoute(async (req, res) => {
    const saved = await store.getSettings();
    const { provider, apiKey, model, baseUrl } = req.body || {};
    const candidate = {
      provider: provider ?? saved.provider,
      apiKey: (apiKey && String(apiKey).trim()) || saved.apiKey,
      model: model ?? saved.model,
      baseUrl: baseUrl ?? saved.baseUrl
    };
    try {
      return res.json({ ok: true, ...(await testConnection(candidate)) });
    } catch (error) {
      return res.json({ ok: false, error: error.message });
    }
  })
);

app.post(
  "/api/draft-bid",
  checkWorker,
  asyncRoute(async (req, res) => {
    const { project } = req.body || {};
    if (!project || !project.title) {
      return res.status(400).json({ error: "Missing project payload" });
    }
    try {
      return res.json({ draft: await generateBid(project, await store.getSettings()) });
    } catch (error) {
      return res.status(502).json({ error: error.message });
    }
  })
);

module.exports = app;
