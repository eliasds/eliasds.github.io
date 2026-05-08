const fs = require("node:fs/promises");
const path = require("node:path");

const MAX_FIELD = 120;
const ALLOWED_EVENTS = new Set([
  "click",
  "video_play",
  "video_end",
  "form_submit_attempt",
  "form_submit_blocked",
  "form_submit_passed",
]);

const dataDir = process.env.ANALYTICS_DATA_DIR || "/tmp";
const eventsFile = path.join(dataDir, "dicotic-events.jsonl");

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function clean(value, fallback = "") {
  if (typeof value !== "string") return fallback;
  const v = value.trim();
  if (!v) return fallback;
  return v.slice(0, MAX_FIELD);
}

function normalizeEvent(body) {
  const eventName = clean(body && body.eventName);
  if (!ALLOWED_EVENTS.has(eventName)) return null;

  const pagePath = clean(body && body.pagePath, "/");
  const context = clean(body && body.context, "unknown");
  const element = clean(body && body.element);
  const href = clean(body && body.href);

  const minute = clean(body && body.occurredAtMinute);
  const minuteDate = new Date(minute);
  const occurredAtMinute = Number.isNaN(minuteDate.getTime())
    ? new Date().toISOString().slice(0, 16) + ":00.000Z"
    : minuteDate.toISOString().slice(0, 16) + ":00.000Z";

  return {
    schemaVersion: "2026-05-05",
    eventName,
    pagePath,
    context,
    element,
    href,
    occurredAtMinute,
    receivedAt: new Date().toISOString(),
  };
}

async function appendEvent(eventRecord) {
  const line = JSON.stringify(eventRecord) + "\n";
  await fs.mkdir(dataDir, { recursive: true });
  await fs.appendFile(eventsFile, line, "utf8");
}

module.exports = async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "method_not_allowed" });

  const eventRecord = normalizeEvent(req.body || {});
  if (!eventRecord) return res.status(400).json({ ok: false, error: "invalid_event" });

  try {
    await appendEvent(eventRecord);
    return res.status(202).json({ ok: true });
  } catch (error) {
    return res.status(500).json({ ok: false, error: "write_failed" });
  }
};
