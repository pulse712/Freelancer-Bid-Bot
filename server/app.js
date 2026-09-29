const path = require("path");
const express = require("express");
const cors = require("cors");
require("dotenv").config();

const store = require("./store");
const auth = require("./auth");
const dashboardHtml = require("./dashboard");
const loginHtml = require("./login");
const { generateBid } = require("./ai");
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

async function prepareTask(task) {
  task.project = null;
  task.draft = null;
  task.note = null;
  task.result = null;
  task.status = "queued";
  task.claimedAt = null;
  return task;
}

async function enrichTaskProject(taskId) {
  const task = await store.getTask(taskId);
  if (!task || task.status === "done" || task.status === "failed") return;
  try {
    task.project = await fetchProject(task.url);
    task.note = null;
  } catch (error) {
    task.note = `Project lookup failed (${error.message}); the worker will read the page.`;
  }
  const latest = await store.getTask(taskId);
  if (!latest || latest.status === "done" || latest.status === "failed") return;
  latest.project = task.project;
  latest.note = task.note;
  await store.saveTask(latest);
}

const STATIC_ICONS = {
  "/favicon.svg": "favicon.svg",
  "/favicon.ico": "favicon.ico",
  "/apple-touch-icon.png": "apple-touch-icon.png"
};

for (const [route, file] of Object.entries(STATIC_ICONS)) {
  app.get(route, (_req, res) => {
    res.set("Cache-Control", "public, max-age=86400");
    res.sendFile(path.join(__dirname, file));
  });
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "bid-bot-backend", storage: store.storageKind, passwordEnabled: auth.passwordEnabled });
});

app.get("/login", (req, res) => {
  if (auth.isLoggedIn(req)) {
    return res.redirect("/");
  }
  return res.type("html").send(loginHtml);
});

app.post("/api/login", (req, res) => {
  if (!auth.passwordEnabled) {
    return res.json({ ok: true });
  }
  if (auth.tooManyAttempts(req)) {
    return res.status(429).json({ error: "Too many attempts. Wait 10 minutes and try again." });
  }
  if (!auth.checkPassword(req.body?.password)) {
    return res.status(401).json({ error: "Wrong password" });
  }
  auth.clearAttempts(req);
  auth.login(req, res);
  return res.json({ ok: true });
});

app.post("/api/logout", (req, res) => {
  auth.logout(req, res);
  return res.json({ ok: true });
});

app.get("/api/session", (req, res) => {
    res.json({ passwordEnabled: auth.passwordEnabled, loggedIn: auth.isLoggedIn(req), storage: store.storageKind });
});

// Everything below needs a dashboard login, except worker routes (guarded by the worker token).
const WORKER_ROUTES = [/^\/api\/worker\//, /^\/api\/draft-bid$/];

app.use((req, res, next) => {
  if (auth.isLoggedIn(req) || WORKER_ROUTES.some((pattern) => pattern.test(req.path))) {
    return next();
  }
  if (req.path.startsWith("/api/")) {
    return res.status(401).json({ error: "Login required" });
  }
  return res.redirect("/login");
});

app.get("/", (_req, res) => {
  res.type("html").send(dashboardHtml);
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
      const task = await store.createTask(
        await prepareTask({
          id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
          workerId,
          url: item,
          type: "create_bid",
          attempts: 0,
          meta: meta || null,
          createdAt: new Date().toISOString(),
          claimedAt: null
        })
      );
      tasks.push(task);
      enrichTaskProject(task.id).catch((error) => console.error("Project lookup failed:", error));
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
    await prepareTask(task);
    await store.requeueTask(task);
    enrichTaskProject(task.id).catch((error) => console.error("Project lookup failed:", error));
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
    return res.json({ workers: await store.listDashboardWorkers() });
  })
);

app.post(
  "/api/workers",
  asyncRoute(async (req, res) => {
    const workerId = String(req.body?.workerId || "").trim();
    const name = String(req.body?.name || "").trim();
    if (!workerId) {
      return res.status(400).json({ error: "workerId is required" });
    }
    const roster = await store.upsertRosterWorker(workerId, name);
    return res.json({ ok: true, workers: await store.listDashboardWorkers(), roster });
  })
);

app.delete(
  "/api/workers/:workerId",
  asyncRoute(async (req, res) => {
    await store.removeRosterWorker(req.params.workerId);
    return res.json({ ok: true, workers: await store.listDashboardWorkers() });
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
