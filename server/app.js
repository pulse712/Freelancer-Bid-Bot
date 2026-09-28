const express = require("express");
const cors = require("cors");
require("dotenv").config();

const store = require("./store");
const dashboardHtml = require("./dashboard");
const { generateDraft, buildTemplateDraft } = require("./ai");

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

    const tasks = [];
    for (const item of list) {
      tasks.push(
        await store.createTask({
          id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
          workerId,
          url: item,
          type: "create_bid",
          status: "queued",
          attempts: 0,
          meta: meta || null,
          createdAt: new Date().toISOString(),
          claimedAt: null
        })
      );
    }
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
    task.result = null;
    await store.requeueTask(task);
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

app.post("/api/draft-bid", checkWorker, async (req, res) => {
  const { project, profileSummary, aiConfig } = req.body || {};
  if (!project || !project.title) {
    return res.status(400).json({ error: "Missing project payload" });
  }
  try {
    return res.json(await generateDraft(project, profileSummary, aiConfig));
  } catch (error) {
    console.error("Draft generation failed:", error.message);
    return res.json({
      draft: buildTemplateDraft(project, profileSummary),
      source: "template-fallback",
      warning: error.message
    });
  }
});

module.exports = app;
