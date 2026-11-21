# Uptime Monitor

Checks my websites every minute, keeps the full history in BigQuery and sends a Telegram alert when a site goes down or comes back. Serverless on Google Cloud's free tier.

```
Cloud Scheduler ──(every minute)──▶ Cloud Run job ──▶ Pub/Sub ──▶ BigQuery (history, uptime %)
                                      │  check all sites in parallel
                                      │  retry once before calling it "down"
                                      ├──▶ Firestore (last known state)
                                      └──▶ Telegram (only on down / recovered)
```

## Features
- Parallel HTTP checks with timeout, expected status code and optional "must contain" text
- **No false alarms**: a failed check is retried once before a site counts as down
- **Alerts only on changes**: "🔴 Portfolio is DOWN" and "🟢 Portfolio is back UP after 4 min", never every minute
- Full history in a **day-partitioned BigQuery table**: uptime %, response times, incidents
- Runs as a **Cloud Run job** on a schedule: no server running between checks

## Run locally

```bash
npm install
cp .env.example .env
npm run check        # one run
npm run dev          # every minute, like production
npm test
```

Sites to monitor are in [sites.json](sites.json).

## Deploy
See [infra/setup-gcp.md](infra/setup-gcp.md).

## Roadmap
- [ ] Public status page (Next.js on Vercel) with 90-day uptime bars
- [ ] Incident history and response-time charts
- [ ] Email alerts as a second channel
- [ ] SSL certificate expiry warnings
