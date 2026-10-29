// Run from a separate systemd timer/cron process, not inside the API process.
import dotenv from "dotenv";
import os from "node:os";
import { readFile, writeFile, rename, mkdir, statfs } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

dotenv.config({ path: process.env.MONITOR_ENV_FILE || fileURLToPath(new URL("../.env", import.meta.url)), quiet: true });
const { alertStaffAnomaly } = await import("../src/services/alertService.js");
const { flushAlertQueue, getAlertQueueHealth, getAlertSpoolPath, configuredAlertChannels } = await import("../src/services/alertOutbox.js");
const apply = process.argv.includes("--apply");
const checks = {};
const details = {};
const limit = (name, fallback) => Number.isFinite(Number(process.env[name])) && Number(process.env[name]) > 0 ? Number(process.env[name]) : fallback;
const target = process.env.MONITOR_HEALTH_URL;
const token = process.env.OPS_HEALTH_TOKEN;
if (!target || !token) throw new Error("Set MONITOR_HEALTH_URL and OPS_HEALTH_TOKEN in a private monitor environment file");
const url = new URL(target);
if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) {
  throw new Error("Monitor URL must use HTTPS, except on loopback");
}
try {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, redirect: "error", signal: AbortSignal.timeout(12000) });
  const health = await response.json();
  checks.backend = response.ok && health.healthy === true;
  details.backend = { status: response.status, wordpress: health.wordpress, redis: health.redis, reconcilerOverdue: health.reconciler?.overdue };
} catch { checks.backend = false; details.backend = { reachable: false }; }

// Resource/backup checks run on the VPS itself, independently of the Node API.
let freeMemoryPercent = os.freemem() / os.totalmem() * 100;
if (os.platform() === "linux") {
  // Linux uses otherwise idle RAM for reclaimable page cache; MemFree alone causes false alarms.
  try {
    const memoryInfo = await readFile("/proc/meminfo", "utf8");
    const available = Number(memoryInfo.match(/^MemAvailable:\s+(\d+)/m)?.[1]);
    const total = Number(memoryInfo.match(/^MemTotal:\s+(\d+)/m)?.[1]);
    if (available >= 0 && total > 0) freeMemoryPercent = available / total * 100;
  } catch { /* Fall back to portable OS memory data. */ }
}
checks.memory = freeMemoryPercent >= limit("MONITOR_MIN_FREE_MEMORY_PERCENT", 10);
details.memory = { freePercent: Math.round(freeMemoryPercent) };
if (os.platform() !== "win32") {
  const loadPerCpu = os.loadavg()[1] / os.availableParallelism();
  checks.cpu = loadPerCpu < limit("MONITOR_MAX_LOAD_PER_CPU", 1.5);
  details.cpu = { fiveMinuteLoadPerCpu: Number(loadPerCpu.toFixed(2)) };
}
try {
  const disk = await statfs(process.env.MONITOR_DISK_PATH || "/");
  const freePercent = disk.bavail / disk.blocks * 100;
  checks.disk = freePercent >= limit("MONITOR_MIN_FREE_DISK_PERCENT", 15);
  details.disk = { freePercent: Math.round(freePercent) };
} catch { checks.disk = false; details.disk = { readable: false }; }

for (const [name, marker] of [["backup", process.env.BACKUP_ROOT && join(process.env.BACKUP_ROOT, "last-success")], ["offsiteBackup", process.env.OFFSITE_BACKUP_MARKER]]) {
  if (!marker) {
    checks[name] = false;
    details[name] = { configured: false }; // A missing backup policy is not a healthy backup.
    continue;
  }
  try {
    const timestamp = Number((await readFile(marker, "utf8")).trim()) * 1000;
    const ageHours = (Date.now() - timestamp) / 3600000;
    checks[name] = Number.isFinite(ageHours) && ageHours >= 0 && ageHours <= limit("MONITOR_MAX_BACKUP_AGE_HOURS", 26);
    details[name] = { ageHours: Number(ageHours.toFixed(1)) };
    if (name === "backup") {
      const failedAt = await readFile(join(process.env.BACKUP_ROOT, "last-failure"), "utf8").then(Number).catch(() => 0);
      if (failedAt * 1000 >= timestamp) {
        checks[name] = false;
        details[name].latestAttemptFailed = true;
      }
    }
  } catch { checks[name] = false; details[name] = { readable: false }; }
}
try {
  details.alertQueue = await getAlertQueueHealth();
  checks.alertQueue = details.alertQueue.oldestPendingSeconds < 900 && details.alertQueue.pending < 4500;
} catch { checks.alertQueue = false; }
checks.channels = configuredAlertChannels().length > 0;

if (apply) {
  const statePath = join(getAlertSpoolPath(), "monitor-state.json");
  const previous = await readFile(statePath, "utf8").then(JSON.parse).catch(() => ({}));
  const next = { ...previous };
  const source = process.env.MONITOR_INSTANCE_ID || os.hostname();
  for (const [name, healthy] of Object.entries(checks)) {
    if (!healthy || previous[name] === false) {
      const queued = await alertStaffAnomaly({
        type: healthy ? "MONITOR_RECOVERED" : "MONITOR_FAILURE", severity: healthy ? "info" : "critical",
        message: `${name}: ${healthy ? "recovered" : "needs operator attention"} on ${source}.`,
        dedupKey: `monitor:${source}:${name}:${healthy}`, details: { source, check: name, ...details[name] },
      });
      if (!queued.success) continue; // Preserve recovery/failure state until the alert is at least durable.
    }
    next[name] = healthy;
  }
  await mkdir(getAlertSpoolPath(), { recursive: true, mode: 0o700 });
  const temporary = `${statePath}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(next), { mode: 0o600 });
  await rename(temporary, statePath);
  // This worker can deliver alerts even while the API process is stopped.
  await flushAlertQueue({ budgetMs: 15000 });
}
console.log(JSON.stringify({ apply, checks, details }));
const { closeRedis } = await import("../src/config/redis.js");
await closeRedis();
process.exitCode = Object.values(checks).every(Boolean) ? 0 : 1;
