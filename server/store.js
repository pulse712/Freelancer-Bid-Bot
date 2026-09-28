const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || "";
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || "";
const MAX_RECENT = 500;

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

function createMemoryClient() {
  const data = new Map();
  const list = (key) => {
    if (!data.has(key)) data.set(key, []);
    return data.get(key);
  };
  const set = (key) => {
    if (!data.has(key)) data.set(key, new Set());
    return data.get(key);
  };
  const hash = (key) => {
    if (!data.has(key)) data.set(key, new Map());
    return data.get(key);
  };
  const range = (items, start, stop) => {
    const end = Number(stop) < 0 ? items.length + Number(stop) + 1 : Number(stop) + 1;
    return items.slice(Number(start), end);
  };

  const commands = {
    GET: (key) => data.get(key) ?? null,
    MGET: (...keys) => keys.map((key) => data.get(key) ?? null),
    SET: (key, value) => {
      data.set(key, value);
      return "OK";
    },
    RPUSH: (key, value) => list(key).push(value),
    LPUSH: (key, value) => list(key).unshift(value),
    LPOP: (key) => list(key).shift() ?? null,
    LRANGE: (key, start, stop) => range(list(key), start, stop),
    LTRIM: (key, start, stop) => {
      data.set(key, range(list(key), start, stop));
      return "OK";
    },
    SADD: (key, member) => {
      set(key).add(member);
      return 1;
    },
    SREM: (key, member) => (set(key).delete(member) ? 1 : 0),
    SMEMBERS: (key) => [...set(key)],
    HSET: (key, field, value) => {
      hash(key).set(field, value);
      return 1;
    },
    HGETALL: (key) => [...hash(key)].flat()
  };

  return async function cmd(name, ...args) {
    return commands[name](...args.map(String));
  };
}

const useRedis = Boolean(REDIS_URL && REDIS_TOKEN);
const cmd = useRedis ? createRedisClient() : createMemoryClient();
const storageKind = useRedis ? "redis" : "memory";

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
  listWorkers
};
