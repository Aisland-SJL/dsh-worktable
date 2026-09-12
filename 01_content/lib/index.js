// src/index.ts
import { execFile } from "node:child_process";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { readdirSync, realpathSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve as pathResolve, sep } from "node:path";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

// template/dshell.css
var dshell_default = `/* dsh-worktable \u539F\u751F\u76AE\u80A4 \xB7 DSH \u8BBE\u8BA1\u7CFB\u7EDF\u7EC4\u4EF6\u5E93
   \u7528\u6CD5\uFF1A<link rel="stylesheet" href="/api/worktable/template/dshell.css">
   \u6240\u6709\u989C\u8272\u8D70 DSH \u4E3B\u9898\u53D8\u91CF\uFF08--dsw-alias-*\uFF09\uFF0C\u81EA\u52A8\u9002\u914D\u660E\u6697\u4E3B\u9898\u3002 */
:root { color-scheme: dark; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  background: var(--dsw-alias-bg-base, #0b0e14);
  color: var(--dsw-alias-label-primary, #e6e8eb);
  font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
  font-size: 13px;
  line-height: 1.6;
}
.dshell { display: flex; flex-direction: column; gap: 12px; padding: 14px 16px; min-height: 100%; }
/* \u6587\u5B57\u5C42\u7EA7 */
.dshell-title { margin: 0; font-size: 16px; font-weight: 600; color: var(--dsw-alias-label-primary, #e6e8eb); }
.dshell-sub { margin: 0; font-size: 12px; color: var(--dsw-alias-label-secondary, #9aa4b2); }
.dshell-muted { color: var(--dsw-alias-label-tertiary, #6b7280); font-size: 11.5px; }
/* \u5361\u7247 */
.dshell-card { border: 1px solid var(--dsw-alias-border-l1, #262b36); border-radius: 10px; background: var(--dsw-alias-fill-l1, rgba(255,255,255,.02)); padding: 12px 14px; }
.dshell-card + .dshell-card { margin-top: 10px; }
/* \u6309\u94AE\uFF08\u7EFF\u8272\u4E3B\u6309\u94AE / \u5E7D\u7075\u6309\u94AE / \u5371\u9669\uFF09 */
.dshell-btn { display: inline-flex; align-items: center; gap: 6px; padding: 6px 14px; border-radius: 999px; border: 1px solid transparent; background: #3fb950; color: #0b0e14; font: inherit; font-size: 12.5px; font-weight: 600; cursor: pointer; }
.dshell-btn:hover { filter: brightness(1.08); }
.dshell-btnGhost { background: transparent; border-color: var(--dsw-alias-border-l1, #262b36); color: var(--dsw-alias-label-secondary, #9aa4b2); }
.dshell-btnGhost:hover { color: var(--dsw-alias-label-primary, #e6e8eb); border-color: var(--dsw-alias-border-l2, #3a4150); }
.dshell-btnDanger { background: transparent; border-color: #f85149; color: #f85149; }
/* \u72B6\u6001\u5FBD\u6807\uFF08\u5706\u70B9 + \u6587\u5B57\uFF1B\u7EFF=\u5DF2\u5B8C\u6210 \u9EC4=\u5F85\u529E/\u5F85\u53D1\u5E03 \u7070=\u672A\u5F00\u59CB\uFF09 */
.dshell-badge { display: inline-flex; align-items: center; gap: 6px; padding: 2px 10px; border-radius: 999px; border: 1px solid var(--dsw-alias-border-l1, #262b36); font-size: 11.5px; color: var(--dsw-alias-label-secondary, #9aa4b2); background: var(--dsw-alias-fill-l1, rgba(255,255,255,.03)); }
.dshell-badge::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: var(--dsw-alias-label-tertiary, #6b7280); }
.dshell-badgeDone { color: #3fb950; border-color: rgba(63,185,80,.4); }
.dshell-badgeDone::before { background: #3fb950; box-shadow: 0 0 5px #3fb950; }
.dshell-badgeWait { color: #d29922; border-color: rgba(210,153,34,.4); }
.dshell-badgeWait::before { background: #d29922; box-shadow: 0 0 5px #d29922; }
.dshell-dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: var(--dsw-alias-label-tertiary, #6b7280); }
.dshell-dotDone { background: #3fb950; box-shadow: 0 0 5px #3fb950; }
.dshell-dotWait { background: #d29922; box-shadow: 0 0 5px #d29922; }
/* \u6807\u7B7E\u9875 */
.dshell-tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--dsw-alias-border-l1, #262b36); }
.dshell-tab { padding: 7px 12px; font-size: 12.5px; color: var(--dsw-alias-label-secondary, #9aa4b2); cursor: pointer; border: none; background: none; font: inherit; border-bottom: 2px solid transparent; margin-bottom: -1px; }
.dshell-tabOn { color: var(--dsw-alias-label-primary, #e6e8eb); border-bottom-color: var(--dsw-alias-state-accent-primary, #4f8ef7); }
/* \u5217\u8868 */
.dshell-list { display: flex; flex-direction: column; gap: 6px; }
.dshell-listItem { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 12px; border: 1px solid var(--dsw-alias-border-l1, #262b36); border-radius: 8px; background: var(--dsw-alias-fill-l1, rgba(255,255,255,.02)); cursor: pointer; }
.dshell-listItem:hover { border-color: var(--dsw-alias-border-l2, #3a4150); background: var(--dsw-alias-fill-l1, rgba(255,255,255,.05)); }
.dshell-listItemTitle { font-size: 12.5px; color: var(--dsw-alias-label-primary, #e6e8eb); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dshell-listItemMeta { flex: none; font-size: 11px; color: var(--dsw-alias-label-tertiary, #6b7280); }
/* \u7F51\u683C / \u7EDF\u8BA1 */
.dshell-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }
.dshell-stat { padding: 10px 12px; border: 1px solid var(--dsw-alias-border-l1, #262b36); border-radius: 10px; background: var(--dsw-alias-fill-l1, rgba(255,255,255,.02)); }
.dshell-statLabel { font-size: 11px; color: var(--dsw-alias-label-secondary, #9aa4b2); }
.dshell-statValue { font-size: 20px; font-weight: 600; color: var(--dsw-alias-label-primary, #e6e8eb); }
.dshell-statDelta { font-size: 11px; color: #3fb950; }
/* \u8FDB\u5EA6\u6761 */
.dshell-progress { height: 6px; border-radius: 3px; background: var(--dsw-alias-fill-l1, rgba(255,255,255,.06)); overflow: hidden; }
.dshell-progressBar { height: 100%; border-radius: 3px; background: #3fb950; }
/* \u8F93\u5165 */
.dshell-input, .dshell-textarea { width: 100%; padding: 7px 10px; border: 1px solid var(--dsw-alias-border-l1, #262b36); border-radius: 8px; background: var(--dsw-alias-fill-l1, rgba(255,255,255,.03)); color: var(--dsw-alias-label-primary, #e6e8eb); font: inherit; font-size: 12.5px; outline: none; }
.dshell-input:focus, .dshell-textarea:focus { border-color: var(--dsw-alias-state-accent-primary, #4f8ef7); }
/* \u8868\u683C */
.dshell-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.dshell-table th, .dshell-table td { text-align: left; padding: 7px 10px; border-bottom: 1px solid var(--dsw-alias-border-l1, #262b36); }
.dshell-table th { color: var(--dsw-alias-label-secondary, #9aa4b2); font-weight: 500; }
/* \u952E\u503C\u5BF9 */
.dshell-kv { display: flex; flex-direction: column; gap: 6px; }
.dshell-kvRow { display: flex; justify-content: space-between; gap: 10px; font-size: 12px; }
.dshell-kvKey { color: var(--dsw-alias-label-secondary, #9aa4b2); }
.dshell-kvValue { color: var(--dsw-alias-label-primary, #e6e8eb); text-align: right; }
/* \u5206\u5272\u7EBF */
.dshell-divider { height: 1px; background: var(--dsw-alias-border-l1, #262b36); margin: 6px 0; }
/* \u6EDA\u52A8\u6761 */
::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-thumb { background: rgba(255,255,255,.14); border-radius: 5px; }
::-webkit-scrollbar-track { background: transparent; }
`;

// template/dshell.html
var dshell_default2 = '<!doctype html>\n<!-- dsh-worktable \u539F\u751F\u76AE\u80A4\u6A21\u677F\uFF1A\u65B0\u9875\u9762\u4EE5\u6B64\u4E3A\u57FA\u7840\uFF0C\u66FF\u6362\u4E0B\u9762\u793A\u4F8B\u5185\u5BB9\u5373\u53EF\u3002\n     \u6837\u5F0F\u8868\u7531\u63D2\u4EF6\u63D0\u4F9B\uFF08\u968F\u4E3B\u9898\u81EA\u52A8\u9002\u914D\uFF09\uFF0C\u4E0D\u8981\u590D\u5236\u6216\u6539\u5199\u5B83\u3002 -->\n<html lang="zh-CN">\n<head>\n  <meta charset="utf-8" />\n  <meta name="viewport" content="width=device-width, initial-scale=1" />\n  <title>\u6211\u7684\u7A97\u53E3</title>\n  <link rel="stylesheet" href="/api/worktable/template/dshell.css" />\n</head>\n<body>\n  <div class="dshell">\n    <!-- \u6807\u9898\u533A -->\n    <h1 class="dshell-title">\u7A97\u53E3\u6807\u9898</h1>\n    <p class="dshell-sub">\u4E00\u53E5\u8BDD\u8BF4\u660E\u8FD9\u4E2A\u7A97\u53E3\u505A\u4EC0\u4E48\u3002</p>\n\n    <!-- \u72B6\u6001\u5FBD\u6807\uFF1A\u5DF2\u5B8C\u6210 dshell-badgeDone / \u8FDB\u884C\u4E2D dshell-badgeWait / \u9ED8\u8BA4 -->\n    <div>\n      <span class="dshell-badge dshell-badgeDone">\u5DF2\u5B8C\u6210</span>\n      <span class="dshell-badge dshell-badgeWait">\u8FDB\u884C\u4E2D</span>\n      <span class="dshell-badge">\u672A\u5F00\u59CB</span>\n    </div>\n\n    <!-- \u6807\u7B7E\u9875 -->\n    <div class="dshell-tabs">\n      <button class="dshell-tab dshell-tabOn">\u6982\u89C8</button>\n      <button class="dshell-tab">\u8BE6\u60C5</button>\n      <button class="dshell-tab">\u8BBE\u7F6E</button>\n    </div>\n\n    <!-- \u7EDF\u8BA1\u5361\u7247\u7F51\u683C -->\n    <div class="dshell-grid">\n      <div class="dshell-stat">\n        <div class="dshell-statLabel">\u603B\u6570</div>\n        <div class="dshell-statValue">128</div>\n        <div class="dshell-statDelta">+12.4%</div>\n      </div>\n      <div class="dshell-stat">\n        <div class="dshell-statLabel">\u8FDB\u884C\u4E2D</div>\n        <div class="dshell-statValue">7</div>\n      </div>\n      <div class="dshell-stat">\n        <div class="dshell-statLabel">\u5DF2\u5B8C\u6210</div>\n        <div class="dshell-statValue">121</div>\n      </div>\n    </div>\n\n    <!-- \u5217\u8868 -->\n    <div class="dshell-list">\n      <div class="dshell-listItem">\n        <span class="dshell-listItemTitle">\u6761\u76EE\u4E00\uFF1A\u793A\u4F8B\u5185\u5BB9\u6807\u9898</span>\n        <span class="dshell-listItemMeta">\u6628\u5929</span>\n      </div>\n      <div class="dshell-listItem">\n        <span class="dshell-listItemTitle">\u6761\u76EE\u4E8C\uFF1A\u793A\u4F8B\u5185\u5BB9\u6807\u9898</span>\n        <span class="dshell-badge dshell-badgeDone">\u5DF2\u53D1\u5E03</span>\n      </div>\n    </div>\n\n    <!-- \u5361\u7247 + \u952E\u503C\u5BF9 -->\n    <div class="dshell-card">\n      <h2 class="dshell-sub" style="margin:0 0 8px">\u8BE6\u60C5</h2>\n      <div class="dshell-kv">\n        <div class="dshell-kvRow"><span class="dshell-kvKey">\u5B57\u6BB5 A</span><span class="dshell-kvValue">\u503C A</span></div>\n        <div class="dshell-kvRow"><span class="dshell-kvKey">\u5B57\u6BB5 B</span><span class="dshell-kvValue">\u503C B</span></div>\n      </div>\n      <div class="dshell-divider"></div>\n      <div class="dshell-progress"><div class="dshell-progressBar" style="width:72%"></div></div>\n    </div>\n\n    <!-- \u64CD\u4F5C\u533A -->\n    <div style="display:flex;gap:8px">\n      <button class="dshell-btn">\u4E3B\u8981\u64CD\u4F5C</button>\n      <button class="dshell-btn dshell-btnGhost">\u6B21\u8981\u64CD\u4F5C</button>\n    </div>\n  </div>\n</body>\n</html>\n';

// src/index.ts
function baseDshHome() {
  const env = process.env.DSH_HOME;
  const value = env !== void 0 && env.trim().length > 0 ? env : pathResolve(homedir(), ".dsh");
  if (value === "~") return homedir();
  if (value.startsWith("~/") || value.startsWith("~\\")) return pathResolve(homedir(), value.slice(2));
  return pathResolve(value);
}
var cachedDshHome = null;
var dshHomeSource = "fallback";
function resolveDshHomeSafe() {
  if (cachedDshHome) return cachedDshHome;
  try {
    const pkg = loadPkg("@deepseek-ai/dsh-home-paths");
    if (pkg && typeof pkg.resolveDshHome === "function") {
      const home = pkg.resolveDshHome(void 0, process.env);
      if (typeof home === "string" && home.trim() !== "") {
        dshHomeSource = "official";
        cachedDshHome = home;
        return cachedDshHome;
      }
    }
  } catch {
  }
  dshHomeSource = "fallback";
  cachedDshHome = baseDshHome();
  return cachedDshHome;
}
var PLUGIN_VERSION = false ? "dev" : "0.3.3";
var name = "dsh-worktable";
var inject = ["webServer", "sessions"];
var HEALTH_PATH = "/api/worktable/health";
var MAX_ENTRIES = 500;
var FILE_TYPES = {
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  map: "application/json; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  markdown: "text/markdown; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  log: "text/plain; charset=utf-8",
  pdf: "application/pdf",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  ico: "image/x-icon",
  avif: "image/avif",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  wasm: "application/wasm",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  webm: "video/webm"
};
var SITE_PREFIX = "/api/worktable/site";
var TEMPLATE_PREFIX = "/api/worktable/template";
var loadProbeAttempts = 0;
function loadPkg(pkg) {
  const starts = /* @__PURE__ */ new Set();
  try {
    starts.add(dirname(fileURLToPath(import.meta.url)));
  } catch {
  }
  try {
    starts.add(realpathSync(dirname(fileURLToPath(import.meta.url))));
  } catch {
  }
  for (const start of starts) {
    let dir = start;
    while (dir && dir !== pathResolve(dir, "..")) {
      loadProbeAttempts++;
      try {
        const req = createRequire(pathToFileURL(pathResolve(dir, "__wt_probe__.js")).href);
        return req(pkg);
      } catch {
      }
      dir = pathResolve(dir, "..");
    }
  }
  try {
    const profilesDir = pathResolve(baseDshHome(), "profiles");
    for (const profile of readdirSync(profilesDir, { withFileTypes: true })) {
      if (!profile.isDirectory() && !profile.isSymbolicLink()) continue;
      const nm = pathResolve(profilesDir, profile.name, "node_modules");
      loadProbeAttempts++;
      try {
        const req = createRequire(pathToFileURL(pathResolve(nm, "__wt_probe__.js")).href);
        return req(pkg);
      } catch {
      }
    }
  } catch {
  }
  return null;
}
function __wtLoadProbeStats() {
  return { attempts: loadProbeAttempts, homeSource: dshHomeSource };
}
function serverCwd(ctx, sessionId, clientCwd) {
  if (sessionId) {
    try {
      const headerCwd = ctx.sessions?.get?.(sessionId)?.header?.cwd;
      if (typeof headerCwd === "string" && headerCwd) return headerCwd;
    } catch {
    }
  }
  if (typeof clientCwd === "string" && clientCwd) return clientCwd;
  return process.cwd();
}
function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}
async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}
async function listDirectory(path) {
  const abs = pathResolve(path);
  const dirents = await readdir(abs, { withFileTypes: true });
  const entries = dirents.map((d) => ({ name: d.name, path: abs + sep + d.name, isDir: d.isDirectory(), hidden: d.name.startsWith(".") })).sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name, void 0, { sensitivity: "base" });
  });
  const truncated = entries.length > MAX_ENTRIES;
  return { path: abs, entries: truncated ? entries.slice(0, MAX_ENTRIES) : entries, truncated };
}
function gitExec(args, cwd) {
  return new Promise((resolvePromise, reject) => {
    execFile("git", args, { cwd, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      if (err) reject(err);
      else resolvePromise(stdout);
    });
  });
}
async function gitStatus(cwd) {
  try {
    const branchRaw = await gitExec(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
    const porcelain = await gitExec(["status", "--porcelain=v1", "-z"], cwd);
    const entries = porcelain.split("\0").filter((s) => s.length > 2).map((s) => ({ xy: s.slice(0, 2), path: s.slice(3) }));
    return { isRepo: true, branch: branchRaw.trim() || "HEAD", entries };
  } catch {
    return { isRepo: false, branch: void 0, entries: [] };
  }
}
var AUTH_COOKIE = "wt_auth";
var AUTH_HEADER = "x-wt-pin";
var AUTH_SESSION_MAX = 20;
var AUTH_SESSION_TTL = 30 * 24 * 3600 * 1e3;
var AUTH_FAIL_WINDOW = 60 * 1e3;
var AUTH_FAIL_LIMIT = 5;
var AUTH_LOCK_MS = 10 * 60 * 1e3;
function authFilePath() {
  const override = process.env.DSH_WORKTABLE_AUTH_FILE;
  if (override && override.trim()) return pathResolve(override);
  return pathResolve(resolveDshHomeSafe(), "storages", "worktable-auth.json");
}
var authState = { loaded: false, data: null };
async function loadAuth(force = false) {
  if (authState.loaded && !force) return authState.data;
  try {
    const raw = await readFile(authFilePath(), "utf8");
    authState.data = JSON.parse(raw.charCodeAt(0) === 65279 ? raw.slice(1) : raw);
  } catch {
    authState.data = {};
  }
  authState.loaded = true;
  return authState.data;
}
async function saveAuth(data) {
  authState.data = data;
  authState.loaded = true;
  const fsx = await import("node:fs/promises");
  const file = authFilePath();
  try {
    await fsx.mkdir(dirname(file), { recursive: true });
  } catch {
  }
  await fsx.writeFile(file, JSON.stringify(data), "utf8");
}
function hashPin(pin) {
  const salt = randomBytes(16).toString("hex");
  return { salt, hash: scryptSync(String(pin), salt, 32, { N: 16384 }).toString("hex") };
}
function verifyPin(given, data) {
  const stored = data?.pinHash;
  if (!stored?.salt || !stored?.hash) return false;
  try {
    const calc = scryptSync(String(given), stored.salt, 32, { N: 16384 });
    return timingSafeEqual(calc, Buffer.from(stored.hash, "hex"));
  } catch {
    return false;
  }
}
function parseCookies(header) {
  const out = {};
  for (const part of String(header ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0) out[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return out;
}
function pruneSessions(data) {
  const now = Date.now();
  data.sessions = (data.sessions ?? []).filter((s) => now - s.lastSeen < AUTH_SESSION_TTL);
}
async function issueSession(data) {
  const token = randomBytes(24).toString("hex");
  data.sessions = data.sessions ?? [];
  pruneSessions(data);
  data.sessions.push({ token, lastSeen: Date.now() });
  while (data.sessions.length > AUTH_SESSION_MAX) data.sessions.shift();
  await saveAuth(data);
  return token;
}
function hasSession(data, token) {
  if (!token) return false;
  const now = Date.now();
  const hit = (data.sessions ?? []).find((s) => s.token === token);
  if (!hit) return false;
  if (now - hit.lastSeen >= AUTH_SESSION_TTL) return false;
  hit.lastSeen = now;
  return true;
}
var authFails = /* @__PURE__ */ new Map();
function clientIp(req) {
  return req?.socket?.remoteAddress || "unknown";
}
function rateState(ip) {
  const now = Date.now();
  let b = authFails.get(ip);
  if (!b || now - b.win > AUTH_FAIL_WINDOW) {
    b = { win: now, count: 0, lockUntil: 0 };
    authFails.set(ip, b);
  }
  return b;
}
function rateFail(ip) {
  const b = rateState(ip);
  b.count += 1;
  if (b.count >= AUTH_FAIL_LIMIT) b.lockUntil = Date.now() + AUTH_LOCK_MS;
}
function rateLocked(ip) {
  return Math.max(0, rateState(ip).lockUntil - Date.now());
}
async function authGate(req, urlObj) {
  const data = await loadAuth();
  const first = !data.pinHash;
  const cookies = parseCookies(req?.headers?.cookie);
  if (hasSession(data, cookies[AUTH_COOKIE])) return null;
  const urlToken = urlObj.searchParams.get("auth") || "";
  if (urlToken && hasSession(data, urlToken)) return null;
  const ip = clientIp(req);
  const locked = rateLocked(ip);
  if (locked > 0) return { status: 429, error: "\u5BC6\u7801\u9519\u8BEF\u6B21\u6570\u8FC7\u591A\uFF0C\u9501\u5B9A " + Math.ceil(locked / 1e3) + " \u79D2", firstTime: first };
  const header = String(req?.headers?.[AUTH_HEADER] ?? "");
  if (header && verifyPin(header, data)) return null;
  if (header) rateFail(ip);
  return { status: 401, error: first ? "worktable pin not set yet \u2014 \u9996\u6B21\u8BBF\u95EE\u8BF7\u8BBE\u7F6E\u8BBF\u95EE\u5BC6\u7801" : "pin required", firstTime: first };
}
function deny(req, res, gate) {
  const wantsHtml = req?.method === "GET" && String(req?.headers?.accept ?? "").includes("text/html");
  const status = gate.status === 429 ? 429 : 401;
  const headers = { "cache-control": "no-store", "x-wt-first": gate.firstTime ? "1" : "0" };
  if (wantsHtml) {
    res.writeHead(status, { ...headers, "content-type": "text/html; charset=utf-8" });
    res.end(loginPageHtml(!!gate.firstTime));
    return;
  }
  res.writeHead(status, { ...headers, "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ ok: false, error: gate.error }));
}
async function gateReq(req, res) {
  const gate = await authGate(req, new URL(req?.url ?? "/", "http://dsh.internal"));
  if (!gate) return false;
  deny(req, res, gate);
  return true;
}
function loginPageHtml(firstTime) {
  const head = firstTime ? "\u8BBE\u7F6E\u5DE5\u4F5C\u53F0\u8BBF\u95EE\u5BC6\u7801" : "\u5DE5\u4F5C\u53F0\u8BBF\u95EE\u5BC6\u7801";
  const sub = firstTime ? "\u9996\u6B21\u4F7F\u7528\uFF1A\u7ED9\u672C\u673A\u5DE5\u4F5C\u53F0\u63A5\u53E3\u8BBE\u7F6E\u4E00\u4E2A\u8BBF\u95EE\u5BC6\u7801\uFF08\u53EA\u4FDD\u5B58\u52A0\u76D0\u54C8\u5E0C\uFF09" : "\u672C\u673A\u5DE5\u4F5C\u53F0\u63A5\u53E3\u53D7\u8BBF\u95EE\u5BC6\u7801\u4FDD\u62A4";
  const btn = firstTime ? "\u8BBE\u7F6E\u5E76\u8FDB\u5165" : "\u8FDB\u5165";
  return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + head + '</title><style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--dsw-alias-bg-base,#0b0e14);color:var(--dsw-alias-label-primary,#e6e8eb);font:14px/1.7 system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif}main{max-width:380px;padding:28px;background:var(--dsw-alias-fill-l1,#12161e);border:1px solid var(--dsw-alias-border-l1,#262b36);border-radius:14px;text-align:center}input{width:100%;padding:10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1,#262b36);background:rgba(255,255,255,.05);color:inherit;font:inherit;outline:none;box-sizing:border-box}button{margin-top:10px;width:100%;padding:10px;border:none;border-radius:8px;background:#3fb950;color:#07130a;font-weight:600;cursor:pointer}p{font-size:12px;color:var(--dsw-alias-label-secondary,#9aa4b2)}#m{min-height:18px;font-size:12px;color:#f85149}</style></head><body><main><h2>' + head + "</h2><p>" + sub + '</p><input id="p" type="password" placeholder="\u8BBF\u95EE\u5BC6\u7801" autofocus><button id="b">' + btn + '</button><div id="m"></div></main><script>var i=document.getElementById("p"),b=document.getElementById("b"),m=document.getElementById("m");function go(){fetch("/api/worktable/login",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({pin:i.value})}).then(function(r){return r.json()}).then(function(j){if(j.ok){location.reload()}else{m.textContent=j.error||"\u5BC6\u7801\u9519\u8BEF"}}).catch(function(e){m.textContent=String(e)})}b.onclick=go;i.addEventListener("keydown",function(e){if(e.key==="Enter")go()});</script></body></html>';
}
function setupTerminal(webServer, ctx) {
  if (typeof webServer.registerUpgrade !== "function") return;
  const wsMod = loadPkg("ws");
  const ptyMod = loadPkg("node-pty");
  ctx.logger?.info?.("[dsh-worktable] term deps: ws=" + (wsMod ? "ok" : "MISSING") + " node-pty=" + (ptyMod ? "ok" : "MISSING"));
  if (!wsMod || !ptyMod) {
    ctx.logger?.warn("[dsh-worktable] \u7EC8\u7AEF\u8DEF\u7531\u672A\u6CE8\u518C\uFF1Aws/node-pty \u4E0D\u53EF\u7528");
    return;
  }
  const WebSocketServer = wsMod.WebSocketServer ?? wsMod.default?.WebSocketServer;
  if (!WebSocketServer) return;
  const pty = ptyMod.default ?? ptyMod;
  const wss = new WebSocketServer({ noServer: true });
  const spawnShell = () => process.platform === "win32" ? { cmd: "powershell.exe", args: ["-NoLogo", "-NoProfile"] } : { cmd: process.env.SHELL || "/bin/bash", args: [] };
  const clampDim = (v, fallback) => Math.min(1024, Math.max(2, Number.isFinite(v) ? v : fallback));
  ctx.effect(() => webServer.registerUpgrade({
    path: "/api/worktable/term",
    handler: (req, socket, head) => {
      const uGate = new URL(req.url ?? "/", "http://dsh.internal");
      authGate(req, uGate).then((gate) => {
        if (gate) {
          try {
            socket.write("HTTP/1.1 401 Unauthorized\r\ncontent-type: text/plain; charset=utf-8\r\nconnection: close\r\n\r\nworktable: " + gate.error + "\n");
          } catch {
          }
          try {
            socket.destroy();
          } catch {
          }
          return;
        }
        wss.handleUpgrade(req, socket, head, (ws) => {
          const u = new URL(req.url ?? "/", "http://dsh.internal");
          const cwd = serverCwd(ctx, u.searchParams.get("sessionId") || void 0, u.searchParams.get("cwd") || void 0);
          const cols = clampDim(Number(u.searchParams.get("cols")), 80);
          const rows = clampDim(Number(u.searchParams.get("rows")), 24);
          let term = null;
          try {
            const shell = spawnShell();
            term = pty.spawn(shell.cmd, shell.args, { name: "xterm-256color", cols, rows, cwd, env: process.env });
          } catch (err) {
            try {
              ws.send("\r\n[worktable] \u7EC8\u7AEF\u542F\u52A8\u5931\u8D25\uFF1A" + String(err));
            } catch {
            }
            try {
              ws.close();
            } catch {
            }
            return;
          }
          term.onData((d) => {
            try {
              ws.send(d);
            } catch {
            }
          });
          term.onExit(() => {
            try {
              ws.close();
            } catch {
            }
          });
          ws.on("message", (raw) => {
            const text = String(raw);
            try {
              const msg = JSON.parse(text);
              if (msg && msg.type === "resize" && Number.isFinite(msg.cols) && Number.isFinite(msg.rows)) {
                term.resize(clampDim(msg.cols, cols), clampDim(msg.rows, rows));
                return;
              }
            } catch {
            }
            try {
              term.write(text);
            } catch {
            }
          });
          ws.on("close", () => {
            try {
              term.kill();
            } catch {
            }
          });
        });
      }).catch(() => {
        try {
          socket.destroy();
        } catch {
        }
      });
    }
  }), "dsh-worktable: terminal upgrade");
}
function apply(ctx) {
  const webServer = ctx.webServer;
  if (!webServer) {
    ctx.logger?.warn("[dsh-worktable] ctx.webServer \u4E0D\u53EF\u7528\uFF08headless profile\uFF1F\uFF09\uFF0C\u8DF3\u8FC7\u670D\u52A1\u7AEF\u8DEF\u7531");
    return;
  }
  webServer.register({
    kind: "exact",
    path: HEALTH_PATH,
    handler: (_req, res) => {
      json(res, 200, { plugin: "dsh-worktable", version: PLUGIN_VERSION, ok: true });
    }
  });
  webServer.register({
    kind: "exact",
    path: "/api/worktable/login",
    handler: async (req, res) => {
      try {
        if (req.method !== "POST") {
          res.writeHead(405);
          res.end();
          return;
        }
        const body = await readJsonBody(req);
        const pin = String(body.pin ?? "");
        if (!pin) {
          json(res, 400, { ok: false, error: "missing pin" });
          return;
        }
        const data = await loadAuth();
        if (!data.pinHash) {
          data.pinHash = hashPin(pin);
        } else {
          const ip = clientIp(req);
          const locked = rateLocked(ip);
          if (locked > 0) {
            json(res, 429, { ok: false, error: "\u5BC6\u7801\u9519\u8BEF\u6B21\u6570\u8FC7\u591A\uFF0C\u9501\u5B9A " + Math.ceil(locked / 1e3) + " \u79D2" });
            return;
          }
          if (!verifyPin(pin, data)) {
            rateFail(ip);
            json(res, 401, { ok: false, error: "\u5BC6\u7801\u9519\u8BEF" });
            return;
          }
        }
        const token = await issueSession(data);
        res.writeHead(200, {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
          "set-cookie": AUTH_COOKIE + "=" + token + "; HttpOnly; SameSite=Strict; Path=/; Max-Age=" + 30 * 24 * 3600
        });
        res.end(JSON.stringify({ ok: true, token }));
      } catch (err) {
        json(res, 500, { ok: false, error: String(err) });
      }
    }
  });
  webServer.register({
    kind: "exact",
    path: "/api/worktable/auth",
    handler: async (req, res) => {
      if (await gateReq(req, res)) return;
      json(res, 200, { ok: true });
    }
  });
  webServer.register({
    kind: "exact",
    path: "/api/worktable/file",
    handler: async (req, res) => {
      try {
        if (await gateReq(req, res)) return;
        const u = new URL(req.url ?? "/", "http://dsh.internal");
        const p = u.searchParams.get("path") || "";
        if (!p) {
          json(res, 400, { error: "missing path" });
          return;
        }
        const abs = pathResolve(p);
        const stat = await import("node:fs/promises").then((m) => m.stat(abs));
        if (stat.size > 20 * 1024 * 1024) {
          json(res, 413, { error: "file too large" });
          return;
        }
        const data = await readFile(abs);
        const ext = (abs.split(".").pop() || "").toLowerCase();
        const types = {
          html: "text/html; charset=utf-8",
          htm: "text/html; charset=utf-8",
          css: "text/css; charset=utf-8",
          js: "text/javascript; charset=utf-8",
          mjs: "text/javascript; charset=utf-8",
          json: "application/json; charset=utf-8",
          md: "text/markdown; charset=utf-8",
          markdown: "text/markdown; charset=utf-8",
          txt: "text/plain; charset=utf-8",
          log: "text/plain; charset=utf-8",
          pdf: "application/pdf",
          svg: "image/svg+xml",
          png: "image/png",
          jpg: "image/jpeg",
          jpeg: "image/jpeg",
          gif: "image/gif",
          webp: "image/webp",
          bmp: "image/bmp",
          ico: "image/x-icon"
        };
        res.writeHead(200, { "content-type": FILE_TYPES[ext] ?? "application/octet-stream", "cache-control": "no-store" });
        res.end(data);
      } catch (err) {
        json(res, 404, { error: String(err) });
      }
    }
  });
  webServer.register({
    kind: "prefix",
    path: TEMPLATE_PREFIX,
    handler: (req, res) => {
      try {
        if (req.method !== "GET") {
          res.writeHead(405);
          res.end();
          return;
        }
        const pathname = new URL(req.url ?? "/", "http://dsh.internal").pathname;
        const rel = pathname.slice(TEMPLATE_PREFIX.length);
        if (rel === "/dshell.css") {
          res.writeHead(200, { "content-type": "text/css; charset=utf-8", "cache-control": "no-store" });
          res.end(dshell_default);
        } else {
          res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
          res.end(dshell_default2);
        }
      } catch (err) {
        res.writeHead(404);
        res.end(String(err));
      }
    }
  });
  webServer.register({
    kind: "prefix",
    path: SITE_PREFIX,
    handler: async (req, res) => {
      try {
        if (await gateReq(req, res)) return;
        if (req.method !== "GET") {
          res.writeHead(405);
          res.end();
          return;
        }
        const pathname = new URL(req.url ?? "/", "http://dsh.internal").pathname;
        const segs = pathname.slice(SITE_PREFIX.length).split("/").filter(Boolean);
        const rootToken = decodeURIComponent(segs.shift() ?? "");
        const rel = segs.map((s) => {
          try {
            return decodeURIComponent(s);
          } catch {
            return s;
          }
        }).join("/");
        if (!rootToken) {
          json(res, 400, { error: "missing root" });
          return;
        }
        const root = pathResolve(rootToken);
        let abs = pathResolve(root, rel);
        if (abs !== root && !abs.startsWith(root + sep)) {
          json(res, 403, { error: "outside root" });
          return;
        }
        const statMod = await import("node:fs/promises");
        let info = await statMod.stat(abs).catch(() => null);
        if (info && info.isDirectory()) {
          abs = pathResolve(abs, "index.html");
          info = await statMod.stat(abs).catch(() => null);
        }
        if (!info || !info.isFile()) {
          json(res, 404, { error: "not found" });
          return;
        }
        if (info.size > 40 * 1024 * 1024) {
          json(res, 413, { error: "file too large" });
          return;
        }
        const data = await readFile(abs);
        const ext = (abs.split(".").pop() || "").toLowerCase();
        res.writeHead(200, { "content-type": FILE_TYPES[ext] ?? "application/octet-stream", "cache-control": "no-store" });
        res.end(data);
      } catch (err) {
        json(res, 404, { error: String(err) });
      }
    }
  });
  webServer.register({
    kind: "exact",
    path: "/api/worktable/fs",
    handler: async (req, res) => {
      try {
        if (await gateReq(req, res)) return;
        const body = await readJsonBody(req);
        const path = typeof body.path === "string" && body.path ? body.path : serverCwd(ctx, body.sessionId, body.cwd);
        json(res, 200, await listDirectory(path));
      } catch (err) {
        json(res, 500, { path: "", entries: [], truncated: false, error: String(err) });
      }
    }
  });
  webServer.register({
    kind: "exact",
    path: "/api/worktable/workspaces",
    handler: async (req, res) => {
      try {
        if (await gateReq(req, res)) return;
        let registry = null;
        try {
          registry = ctx.workspaceRegistry ?? null;
        } catch {
        }
        if (!registry) {
          try {
            registry = ctx.get?.("workspaceRegistry") ?? null;
          } catch {
          }
        }
        if (registry && typeof registry.list === "function") {
          const list = registry.list() ?? [];
          const workspaceIds = [];
          const tables = {};
          for (const ws of list) {
            const id = String(ws?.id ?? "");
            if (!id) continue;
            workspaceIds.push(id);
            tables[id] = {
              title: typeof ws?.title === "string" ? ws.title : void 0,
              sessionIds: Array.isArray(ws?.sessionIds) ? ws.sessionIds.map(String) : []
            };
          }
          let archived = [];
          try {
            archived = (registry.archivedSessionIds ?? []).map(String);
          } catch {
          }
          json(res, 200, {
            unit: { name: "workspace", version: 2 },
            global: { initialized: true, workspaceIds, archivedSessionIds: archived },
            tables: { workspaces: tables }
          });
          return;
        }
        const file = pathResolve(resolveDshHomeSafe(), "storages", "workspace.json");
        const raw = await readFile(file, "utf8");
        json(res, 200, JSON.parse(raw.charCodeAt(0) === 65279 ? raw.slice(1) : raw));
      } catch (err) {
        json(res, 404, { error: String(err) });
      }
    }
  });
  webServer.register({
    kind: "exact",
    path: "/api/worktable/write",
    handler: async (req, res) => {
      try {
        if (await gateReq(req, res)) return;
        if (req.method !== "POST") {
          res.writeHead(405);
          res.end();
          return;
        }
        const body = await readJsonBody(req);
        const p = typeof body.path === "string" ? body.path : "";
        const content = typeof body.content === "string" ? body.content : "";
        if (!p) {
          json(res, 400, { error: "missing path" });
          return;
        }
        if (content.length > 20 * 1024 * 1024) {
          json(res, 413, { error: "content too large" });
          return;
        }
        const abs = pathResolve(p);
        await import("node:fs/promises").then((m) => m.writeFile(abs, content, "utf8"));
        json(res, 200, { ok: true });
      } catch (err) {
        json(res, 500, { error: String(err) });
      }
    }
  });
  webServer.register({
    kind: "exact",
    path: "/api/worktable/mkdir",
    handler: async (req, res) => {
      try {
        if (await gateReq(req, res)) return;
        if (req.method !== "POST") {
          res.writeHead(405);
          res.end();
          return;
        }
        const body = await readJsonBody(req);
        const p = typeof body.path === "string" ? body.path.trim() : "";
        if (!p) {
          json(res, 400, { error: "missing path" });
          return;
        }
        const abs = pathResolve(p);
        const fsx = await import("node:fs/promises");
        const parent = dirname(abs);
        try {
          await fsx.access(parent);
        } catch {
          json(res, 400, { error: "parent not found" });
          return;
        }
        await fsx.mkdir(abs);
        json(res, 200, { ok: true, path: abs });
      } catch (err) {
        json(res, err?.code === "EEXIST" ? 200 : 500, err?.code === "EEXIST" ? { ok: true, exists: true } : { error: String(err) });
      }
    }
  });
  webServer.register({
    kind: "exact",
    path: "/api/worktable/git",
    handler: async (req, res) => {
      try {
        if (await gateReq(req, res)) return;
      } catch (err) {
        json(res, 500, { error: String(err) });
        return;
      }
      const body = await readJsonBody(req);
      const cwd = serverCwd(ctx, body.sessionId, body.cwd);
      json(res, 200, await gitStatus(cwd));
    }
  });
  loadAuth().then((d) => ctx.logger?.info?.("[dsh-worktable] \u8BBF\u95EE\u5BC6\u7801\uFF1A" + (d.pinHash ? "\u5DF2\u914D\u7F6E\uFF08/api/worktable/* \u5168\u90E8\u9700\u9274\u6743\uFF09" : "\u672A\u914D\u7F6E\u2014\u2014\u9996\u6B21\u8BBF\u95EE\u5DE5\u4F5C\u53F0\u63A5\u53E3\u65F6\u4F1A\u8981\u6C42\u5728\u9875\u9762\u4E0A\u8BBE\u7F6E\uFF08\u6216 POST /api/worktable/login\uFF09")));
  setupTerminal(webServer, ctx);
}
export {
  HEALTH_PATH,
  __wtLoadProbeStats,
  apply,
  inject,
  name
};
