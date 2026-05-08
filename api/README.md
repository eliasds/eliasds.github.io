# Anonymous Analytics Contract

No cookies, localStorage IDs, or fingerprint fields are used.

## Ingest Endpoint

- `POST /api/collect`
- Body schema:
  - `schemaVersion` string
  - `eventName` one of:
    - `click`
    - `video_play`
    - `video_end`
    - `form_submit_attempt`
    - `form_submit_blocked`
    - `form_submit_passed`
  - `pagePath` string
  - `element` string (optional UI selector/id hint)
  - `href` string (optional)
  - `context` string
  - `occurredAtMinute` ISO timestamp rounded to minute

### Response

- `202 { ok: true }` accepted
- `400 { ok: false, error: "invalid_event" }` invalid payload

## Aggregate Endpoint

- `GET /api/aggregate`
- Returns counts by day, event, and page:
  - `totals.events`
  - `byDay`
  - `byEvent`
  - `byPage`

## Storage

- Server appends newline-delimited JSON records to:
  - `${ANALYTICS_DATA_DIR}/dicotic-events.jsonl`
  - defaults to `/tmp/dicotic-events.jsonl`
