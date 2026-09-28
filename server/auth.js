const crypto = require("crypto");

const PASSWORD = process.env.DASHBOARD_PASSWORD || "";
const COOKIE_NAME = "bidbot_session";
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 10;
const ATTEMPT_WINDOW_MS = 10 * 60 * 1000;

const secret = PASSWORD ? crypto.createHash("sha256").update(`bidbot-session:${PASSWORD}`).digest() : null;
const attempts = new Map();

const passwordEnabled = Boolean(PASSWORD);

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

function sign(expires) {
  return crypto.createHmac("sha256", secret).update(String(expires)).digest("base64url");
}

function createToken() {
  const expires = Date.now() + SESSION_MS;
  return `${expires}.${sign(expires)}`;
}

function verifyToken(token) {
  if (!token || !secret) return false;
  const [expires, signature] = token.split(".");
  if (!/^\d+$/.test(expires) || Number(expires) < Date.now()) return false;
  return safeEqual(signature || "", sign(expires));
}

function parseCookies(header) {
  const cookies = {};
  for (const part of String(header || "").split(";")) {
    const index = part.indexOf("=");
    if (index > 0) {
      cookies[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
    }
  }
  return cookies;
}

function isLoggedIn(req) {
  if (!passwordEnabled) return true;
  return verifyToken(parseCookies(req.headers.cookie)[COOKIE_NAME]);
}

function clientIp(req) {
  return String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "").split(",")[0].trim();
}

function tooManyAttempts(req) {
  const ip = clientIp(req);
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || entry.resetAt < now) {
    attempts.set(ip, { count: 1, resetAt: now + ATTEMPT_WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_ATTEMPTS;
}

function clearAttempts(req) {
  attempts.delete(clientIp(req));
}

function checkPassword(input) {
  return passwordEnabled && safeEqual(input || "", PASSWORD);
}

function setSessionCookie(req, res, value, maxAgeSeconds) {
  const secure = req.secure || req.headers["x-forwarded-proto"] === "https";
  res.set(
    "Set-Cookie",
    `${COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure ? "; Secure" : ""}`
  );
}

function login(req, res) {
  setSessionCookie(req, res, createToken(), Math.floor(SESSION_MS / 1000));
}

function logout(req, res) {
  setSessionCookie(req, res, "", 0);
}

module.exports = { passwordEnabled, isLoggedIn, checkPassword, tooManyAttempts, clearAttempts, login, logout };
