-- Every check result (history for uptime % and response-time charts).
CREATE TABLE IF NOT EXISTS checks (
  ts          TEXT    NOT NULL,     -- ISO 8601 UTC
  site        TEXT    NOT NULL,
  url         TEXT    NOT NULL,
  up          INTEGER NOT NULL,     -- 1 = up, 0 = down
  status_code INTEGER,
  response_ms INTEGER,
  error       TEXT
);
CREATE INDEX IF NOT EXISTS idx_checks_site_ts ON checks (site, ts);

-- Last known state per site, so alerts fire only when a site goes down or comes back.
CREATE TABLE IF NOT EXISTS state (
  site  TEXT PRIMARY KEY,
  up    INTEGER NOT NULL,
  since TEXT    NOT NULL
);
