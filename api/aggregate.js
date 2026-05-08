const fs = require("node:fs/promises");
const path = require("node:path");

const dataDir = process.env.ANALYTICS_DATA_DIR || "/tmp";
const eventsFile = path.join(dataDir, "dicotic-events.jsonl");

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function dayKey(iso) {
  return typeof iso === "string" ? iso.slice(0, 10) : "unknown";
}

function increment(map, key) {
  map[key] = (map[key] || 0) + 1;
}

module.exports = async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "method_not_allowed" });

  try {
    const raw = await fs.readFile(eventsFile, "utf8");
    const lines = raw.split("\n").filter(Boolean);
    const byDay = {};
    const byEvent = {};
    const byPage = {};

    lines.forEach((line) => {
      let parsed = null;
      try {
        parsed = JSON.parse(line);
      } catch (err) {
        return;
      }
      increment(byDay, dayKey(parsed.occurredAtMinute));
      increment(byEvent, parsed.eventName || "unknown");
      increment(byPage, parsed.pagePath || "unknown");
    });

    return res.status(200).json({
      ok: true,
      totals: {
        events: lines.length,
      },
      byDay,
      byEvent,
      byPage,
    });
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return res.status(200).json({
        ok: true,
        totals: { events: 0 },
        byDay: {},
        byEvent: {},
        byPage: {},
      });
    }
    return res.status(500).json({ ok: false, error: "read_failed" });
  }
};
