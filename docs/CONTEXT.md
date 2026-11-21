# Uptime Monitor: project knowledge & context

Single source of truth for how this project works, why it is built this way, and how to run, deploy and extend it.

---

## 1. What it is

A serverless uptime monitor, built and run by Ravindra Chaubey.

- Checks a list of websites **every minute** from Cloudflare's network.
- Keeps **90 days of history** and shows a **public status page** (uptime 24 h / 7 d / 30 d, average response time, 30-day bars).
- Sends a **Telegram alert only when a site goes down or comes back**, never every minute.
- Runs entirely on **Cloudflare's free tier** (Workers + Cron Triggers + D1). Cost: ₹0/month.

| | |
|---|---|
| Status page | https://uptime-monitor.ravindrachaubey.workers.dev |
| JSON API | https://uptime-monitor.ravindrachaubey.workers.dev/api/status |
| Repo | https://github.com/cypher1ravi/uptime-monitor |

Monitored now ([sites.json](../sites.json)):

| Name | URL | Extra rule |
|---|---|---|
| Portfolio | https://ravindrachaubey.vercel.app/ | status < 400 |
| Folify | https://folify-gen.vercel.app/ | status < 400 |
| Portfolio sitemap | https://ravindrachaubey.vercel.app/sitemap.xml | exactly 200 |
| Pulse Analytics API | https://pulse-analytics.ravindrachaubey.workers.dev/healthz | body contains `"ok":true` |

---

## 2. Architecture

```
Cloudflare Cron Trigger "* * * * *"
        │
        ▼
scheduled() in src/index.ts ──▶ runChecks() in src/monitor.ts
        │
        ├─ 1. check every site IN PARALLEL (Promise.all)        src/check.ts
        │      fetch, follow redirects, 10 s timeout
        │      up = status rule + optional mustContain text
        │      FAILED? wait 3 s, check once more (no false alarms)
        │
        ├─ 2. load last known state                              D1: state
        ├─ 3. findTransitions(): UP→DOWN or DOWN→UP only        src/alert.ts
        ├─ 4. one D1 batch: INSERT every result                 D1: checks
        │                    UPSERT state for changed sites      D1: state
        │                    (on the hour) DELETE checks older than RETENTION_DAYS
        └─ 5. Telegram message per transition                    api.telegram.org

Visitors
  GET /            ──▶ getStatus() ──▶ renderStatusPage()  (server-rendered HTML, no client JS)
  GET /api/status  ──▶ getStatus() ──▶ JSON
```

### Source files

| File | Responsibility |
|---|---|
| `src/index.ts` | Worker entry. `fetch` → Hono routes (`/`, `/api/status`, `/healthz`). `scheduled` → `runChecks` via `ctx.waitUntil`. Imports `sites.json`. |
| `src/check.ts` | `checkSite()`: one HTTP check with timeout, status/text rules, retry once on failure. Types `Site`, `CheckResult`. |
| `src/alert.ts` | `findTransitions()`, `formatAlert()`, `formatDuration()`, `sendAlert()` (Telegram, or console log when not configured). |
| `src/monitor.ts` | `runChecks()` (the cron job) and `getStatus()` (uptime %, averages, 30 daily buckets). Defines `Env`. |
| `src/page.ts` | `renderStatusPage()`: HTML + inline CSS, HTML-escaped, light/dark mode, refresh every 60 s. |
| `migrations/0001_init.sql` | `checks` table + `(site, ts)` index, `state` table. |
| `test/d1.ts` | D1 stand-in on Node's built-in `node:sqlite`. |
| `test/monitor.test.ts` | Real HTTP checks against a local server, alert logic, full cron runs, status page, retention. |

---

## 3. Data model

```sql
checks (               -- one row per site per minute (history)
  ts TEXT, site TEXT, url TEXT,
  up INTEGER,          -- 1 / 0
  status_code INTEGER, response_ms INTEGER, error TEXT
)
INDEX idx_checks_site_ts (site, ts)

state (                -- last known status per site (drives alerts)
  site TEXT PRIMARY KEY, up INTEGER, since TEXT
)
```

Volume: 4 sites × 1,440 runs/day = 5,760 rows/day ≈ 518k rows over 90 days, well inside D1's 500 MB per database and 100k writes/day.

---

## 4. Key design decisions

### 4.1 Alert on state transitions, not on every failure
A naive monitor sends "site down" every minute (60 messages/hour). `state` remembers each site's last status; alerts fire only on **UP→DOWN** and **DOWN→UP**. The recovery message includes the outage length from `state.since`. A brand-new site that is already up is silent; a brand-new site that is down alerts once.

### 4.2 Retry once before calling a site down
Transient network blips are common. A failed check waits `RETRY_DELAY_MS` (3 s) and tries again; only a second failure counts as down. The first failure is not stored.

### 4.3 Parallel checks
`Promise.all` means total run time ≈ slowest site (plus a retry), not the sum. Waiting on `fetch` is I/O, not CPU, so it doesn't count against the Workers free plan's 10 ms CPU limit.

### 4.4 Server-rendered status page
Plain HTML + inline CSS from the Worker: no framework, instant load, works without JavaScript, auto-refresh via `<meta http-equiv="refresh" content="60">`. Bar colours: green ≥ 99.5 %, yellow ≥ 95 %, red below, grey no data.

### 4.5 Uptime maths in SQL
`getStatus()` runs one D1 batch per site: conditional `SUM`/`COUNT` for 24 h / 7 d / 30 d in a single scan, last check, current state, and per-day buckets (`substr(ts,1,10)`). Missing days are filled as `null` in code so the page always shows 30 bars.

### 4.6 Why Cloudflare (and not Google Cloud)
First version ran on Google Cloud (Cloud Scheduler → Cloud Run job → Pub/Sub → BigQuery, state in Firestore). GCP needed active billing (₹1,000 prepayment on the billing account), and every-minute Cloud Run jobs would exceed its free CPU allowance. Cloudflare's Cron Triggers run every minute for free. GCP version is in git history (`2c7c7aa` … `21bce8e`).

### 4.7 Secrets
Telegram bot token and chat id are Cloudflare **secrets**, not in code or `wrangler.jsonc`.

---

## 5. Configuration

`wrangler.jsonc`:

| Setting | Value | Meaning |
|---|---|---|
| `triggers.crons` | `* * * * *` | Run every minute |
| `STATUS_PAGE_TITLE` | `Ravindra's services` | Page heading |
| `CHECK_TIMEOUT_MS` | `10000` | Per-request timeout |
| `RETRY_DELAY_MS` | `3000` | Wait before the retry |
| `RETENTION_DAYS` | `90` | History kept (pruned hourly) |

Secrets: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` (both set). Without them, alerts are logged instead of sent.

D1: database `uptime`, id `27820200-3039-458b-a625-a669ae1e0405`, binding `DB`.

### Adding a site
Edit `sites.json`:
```json
{ "name": "My API", "url": "https://api.example.com/health", "expectStatus": 200, "mustContain": "ok" }
```
`expectStatus` and `mustContain` are optional. Then `npm test` and `npx wrangler deploy`. The `name` is the key in history and state, so renaming a site starts a new history.

Workers free plan allows 50 subrequests per invocation: each site uses 1–2 fetches, Telegram 1 per alert. Keep the list under ~20 sites.

---

## 6. Develop, test, deploy

```bash
npm install
npm test             # 4 tests incl. real HTTP checks and full cron runs on node:sqlite
npm run typecheck

# Local Worker (Windows needs the Microsoft Visual C++ Redistributable x64 for workerd)
npm run db:migrate:local
npm run dev          # http://localhost:8787 ; trigger a run: http://localhost:8787/__scheduled

# Deploy
npx wrangler login
npm run db:migrate:remote      # only when migrations/ changes
npx wrangler deploy
```
New cron triggers can take a few minutes to start after the first deploy (observed ~5 min on 2026-11-21).

---

## 7. Operations

```bash
npx wrangler tail uptime-monitor         # watch each run: "UP Portfolio 218ms | ..."
npx wrangler d1 execute uptime --remote --command "SELECT * FROM state"
npx wrangler d1 execute uptime --remote --command \
  "SELECT ts, site, error FROM checks WHERE up = 0 ORDER BY ts DESC LIMIT 20"    # recent incidents
```
Telegram not arriving: check the bot was messaged at least once (bots can't start chats), the chat id is correct, and `wrangler tail` for `[alert] Telegram error`.

---

## 8. Known limitations

- The monitor runs on Cloudflare; if Cloudflare itself is down, nobody alerts. Fix: a second, independent checker (e.g. a GitHub Actions cron) that only checks this status page.
- Checks run from whichever Cloudflare location runs the cron, not from multiple regions.
- No SSL certificate expiry warnings yet.
- Tests use `node:sqlite` rather than the Workers runtime.

## 9. Roadmap

1. SSL expiry warnings (alert 14 days before).
2. Response-time sparkline per site on the status page.
3. Incident history section (start, end, duration).
4. Email as a second alert channel.
5. Multi-region checks to confirm an outage before alerting.

---

## 10. History

| Commit | Change |
|---|---|
| `2c7c7aa` | First version on Google Cloud (Cloud Run job, Pub/Sub, BigQuery, Firestore) |
| `00c9b83`, `21bce8e` | GCP setup fixes, 3-minute schedule |
| `5cd297c` | Moved to Cloudflare Workers + D1, status page added |
| `a39ba4e` | Production D1 binding |
| `db23d93` | Also monitors the Pulse Analytics API |

Deployed 2026-11-21. First scheduled run: all sites up, ~200–240 ms.

## 11. Explaining it (interview notes)

> "A serverless uptime monitor on Cloudflare. A cron trigger runs every minute, checks all sites in parallel, retries once to avoid false alarms and stores results in D1. Alerts go to Telegram only on state transitions, down or recovered, so there's no alert spam. A server-rendered status page shows 24 h / 7 d / 30 d uptime computed in SQL."

Likely follow-ups: what if Cloudflare is down (independent second checker) · why retry (false positives vs detection delay) · how uptime % is computed (conditional aggregates over the `(site, ts)` index) · scaling to hundreds of sites (fan out across invocations or Queues, subrequest limits).
