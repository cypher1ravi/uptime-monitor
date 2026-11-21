# Uptime Monitor

Checks my websites every minute, shows a **public status page**, and sends a **Telegram alert** when a site goes down or comes back. Runs entirely on **Cloudflare's free tier** (Workers + Cron Triggers + D1).

```
Cron Trigger (every minute) ──▶ Worker ──▶ check all sites in parallel (retry once before "down")
                                   ├──▶ D1: full history + last known state
                                   └──▶ Telegram, only when a site goes down / recovers

Visitors ──▶ GET /          server-rendered status page (30-day uptime bars)
             GET /api/status JSON for other dashboards
```

> Full project notes (architecture, decisions, operations): [docs/CONTEXT.md](docs/CONTEXT.md)

## Features
- Parallel HTTP checks with timeout, expected status code and optional "must contain" text
- **No false alarms**: a failed check is retried once before a site counts as down
- **Alerts only on changes**: "🔴 Portfolio is DOWN" and "🟢 Portfolio is back UP after 4 min", never every minute
- **Status page**: uptime for 24 h / 7 d / 30 d, average response time, 30-day bar chart, light and dark mode, auto-refresh
- History kept for 90 days, pruned hourly so the free 500 MB database never fills up

Sites to monitor are in [sites.json](sites.json).

## Run tests
```bash
npm install
npm test          # real HTTP checks against a local server + SQL on Node's built-in SQLite
npm run typecheck
```
Local server: `npm run db:migrate:local && npm run dev`, then open http://localhost:8787 and trigger a run at http://localhost:8787/__scheduled (needs the Microsoft Visual C++ Redistributable on Windows).

## Deploy (free, no card)
```bash
npx wrangler login
npx wrangler d1 create uptime              # copy the database_id into wrangler.jsonc
npm run db:migrate:remote
npx wrangler secret put TELEGRAM_BOT_TOKEN # from @BotFather
npx wrangler secret put TELEGRAM_CHAT_ID   # from https://api.telegram.org/bot<TOKEN>/getUpdates
npx wrangler deploy                        # status page: https://uptime-monitor.<subdomain>.workers.dev
```

## Roadmap
- [ ] SSL certificate expiry warnings
- [ ] Response-time chart per site
- [ ] Email alerts as a second channel
