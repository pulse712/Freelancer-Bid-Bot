const fs = require("fs");
const path = require("path");
require("dotenv").config();

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || "";
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || "";
const MAX_RECENT = 500;

function snapshotPath() {
  if (process.env.BIDBOT_DATA_FILE) return process.env.BIDBOT_DATA_FILE;
  if (process.env.VERCEL) return path.join("/tmp", "bidbot-store.json");
  return path.join(__dirname, "..", ".data", "store.json");
}

function createRedisClient() {
  return async function cmd(...args) {
    const response = await fetch(REDIS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${REDIS_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(args.map(String))
    });
    const payload = await response.json();
    if (!response.ok || payload.error) {
      throw new Error(`Redis ${args[0]} failed: ${payload.error || response.status}`);
    }
    return payload.result;
  };
}

function emptyState() {
  return { kv: {}, lists: {}, sets: {}, hashes: {} };
}

function loadFileState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(snapshotPath(), "utf8"));
    return {
      kv: parsed.kv || {},
      lists: parsed.lists || {},
      sets: parsed.sets || {},
      hashes: parsed.hashes || {}
    };
  } catch (_error) {
    return emptyState();
  }
}

function createFileClient() {
  const state = loadFileState();

  function persist() {
    const file = snapshotPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(state));
  }

  function list(key) {
    if (!Array.isArray(state.lists[key])) state.lists[key] = [];
    return state.lists[key];
  }

  function setOf(key) {
    if (!Array.isArray(state.sets[key])) state.sets[key] = [];
    return state.sets[key];
  }

  function hash(key) {
    if (!state.hashes[key] || typeof state.hashes[key] !== "object") state.hashes[key] = {};
    return state.hashes[key];
  }

  function range(items, start, stop) {
    const end = Number(stop) < 0 ? items.length + Number(stop) + 1 : Number(stop) + 1;
    return items.slice(Number(start), end);
  }

  const mutating = new Set(["SET", "RPUSH", "LPUSH", "LPOP", "LTRIM", "SADD", "SREM", "HSET"]);

  const commands = {
    GET: (key) => state.kv[key] ?? null,
    MGET: (...keys) => keys.map((key) => state.kv[key] ?? null),
    SET: (key, value) => {
      state.kv[key] = value;
      return "OK";
    },
    RPUSH: (key, value) => list(key).push(value),
    LPUSH: (key, value) => list(key).unshift(value),
    LPOP: (key) => list(key).shift() ?? null,
    LRANGE: (key, start, stop) => range(list(key), start, stop),
    LTRIM: (key, start, stop) => {
      state.lists[key] = range(list(key), start, stop);
      return "OK";
    },
    SADD: (key, member) => {
      const items = setOf(key);
      if (items.includes(member)) return 0;
      items.push(member);
      return 1;
    },
    SREM: (key, member) => {
      const items = setOf(key);
      const next = items.filter((item) => item !== member);
      const removed = next.length !== items.length;
      state.sets[key] = next;
      return removed ? 1 : 0;
    },
    SMEMBERS: (key) => [...setOf(key)],
    HSET: (key, field, value) => {
      hash(key)[field] = value;
      return 1;
    },
    HGETALL: (key) => Object.entries(hash(key)).flat()
  };

  return async function cmd(name, ...args) {
    const result = commands[name](...args.map(String));
    if (mutating.has(name)) persist();
    return result;
  };
}

const useRedis = Boolean(REDIS_URL && REDIS_TOKEN);
const cmd = useRedis ? createRedisClient() : createFileClient();
const storageKind = useRedis ? "redis" : "file";

async function saveTask(task) {
  await cmd("SET", `task:${task.id}`, JSON.stringify(task));
  return task;
}

async function getTasks(ids) {
  if (!ids.length) return [];
  const raws = await cmd("MGET", ...ids.map((id) => `task:${id}`));
  return raws.filter(Boolean).map((raw) => JSON.parse(raw));
}

async function getTask(id) {
  const [task] = await getTasks([id]);
  return task || null;
}

async function createTask(task) {
  await saveTask(task);
  await cmd("RPUSH", `queue:${task.workerId}`, task.id);
  await cmd("LPUSH", "tasks:recent", task.id);
  await cmd("LTRIM", "tasks:recent", 0, MAX_RECENT - 1);
  return task;
}

async function requeueTask(task) {
  task.status = "queued";
  task.claimedAt = null;
  await saveTask(task);
  await cmd("SREM", `inflight:${task.workerId}`, task.id);
  await cmd("RPUSH", `queue:${task.workerId}`, task.id);
  return task;
}

async function claimNextTask(workerId) {
  for (;;) {
    const id = await cmd("LPOP", `queue:${workerId}`);
    if (!id) return null;
    const task = await getTask(id);
    if (!task || task.status !== "queued") continue;

    task.status = "dispatched";
    task.claimedAt = new Date().toISOString();
    task.attempts = (task.attempts || 0) + 1;
    await saveTask(task);
    await cmd("SADD", `inflight:${workerId}`, id);
    return task;
  }
}

async function listInflight(workerId) {
  const ids = await cmd("SMEMBERS", `inflight:${workerId}`);
  return getTasks(ids);
}

async function finishTask(task, status, details) {
  task.status = status === "success" ? "done" : "failed";
  task.finishedAt = new Date().toISOString();
  task.result = details || null;
  if (details && details.draft) {
    task.draft = details.draft;
  }
  await saveTask(task);
  await cmd("SREM", `inflight:${task.workerId}`, task.id);

  const record = {
    taskId: task.id,
    workerId: task.workerId,
    url: task.url,
    title: task.project?.title || "",
    status,
    details: details || null,
    at: task.finishedAt
  };
  await cmd("LPUSH", "results:recent", JSON.stringify(record));
  await cmd("LTRIM", "results:recent", 0, MAX_RECENT - 1);
  return task;
}

async function listRecentTasks(limit = 100) {
  const ids = await cmd("LRANGE", "tasks:recent", 0, limit - 1);
  return getTasks(ids);
}

async function listResults(limit = 100) {
  const raws = await cmd("LRANGE", "results:recent", 0, limit - 1);
  return raws.map((raw) => JSON.parse(raw));
}

async function touchWorker(workerId) {
  await cmd("HSET", "workers", workerId, JSON.stringify({ lastSeen: new Date().toISOString() }));
}

async function listWorkers() {
  const flat = await cmd("HGETALL", "workers");
  const workers = [];
  for (let i = 0; i < flat.length; i += 2) {
    workers.push({ workerId: flat[i], ...JSON.parse(flat[i + 1]) });
  }
  return workers;
}

async function listRoster() {
  const raw = await cmd("GET", "roster");
  return raw ? JSON.parse(raw) : [];
}

async function saveRoster(roster) {
  await cmd("SET", "roster", JSON.stringify(roster));
  return roster;
}

async function upsertRosterWorker(workerId, name) {
  const id = String(workerId || "").trim();
  if (!id) throw new Error("Worker ID is required");
  const label = String(name || "").trim() || id;
  const roster = await listRoster();
  const existing = roster.find((item) => item.workerId === id);
  if (existing) {
    existing.name = label;
  } else {
    roster.push({ workerId: id, name: label });
  }
  return saveRoster(roster);
}

async function removeRosterWorker(workerId) {
  const roster = (await listRoster()).filter((item) => item.workerId !== workerId);
  return saveRoster(roster);
}

async function listDashboardWorkers() {
  const [roster, live] = await Promise.all([listRoster(), listWorkers()]);
  const seen = Object.fromEntries(live.map((item) => [item.workerId, item]));
  return roster.map((item) => ({
    workerId: item.workerId,
    name: item.name || item.workerId,
    lastSeen: seen[item.workerId]?.lastSeen || null
  }));
}

async function getSettings() {
  const raw = await cmd("GET", "settings");
  return raw ? JSON.parse(raw) : {};
}

async function saveSettings(settings) {
  await cmd("SET", "settings", JSON.stringify(settings));
  return settings;
}

module.exports = {
  storageKind,
  getSettings,
  saveSettings,
  saveTask,
  getTask,
  createTask,
  requeueTask,
  claimNextTask,
  listInflight,
  finishTask,
  listRecentTasks,
  listResults,
  touchWorker,
  listWorkers,
  listRoster,
  upsertRosterWorker,
  removeRosterWorker,
  listDashboardWorkers
};
