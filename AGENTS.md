# Working on this repo

Read [docs/CONTEXT.md](docs/CONTEXT.md) first: architecture, data model, decisions, deployment and operations.

## Rules
- **No alert spam.** Alerts fire only on state transitions (UP→DOWN, DOWN→UP). Keep the retry-before-down behaviour.
- **Stay inside Cloudflare's free tier.** The cron runs every minute: keep each run light (parallel fetches, one D1 batch). Free Workers allow 50 subrequests per invocation, so mind the number of sites.
- **Every history query** filters on `site` and `ts` (uses the `(site, ts)` index).
- **Schema changes** go in a new `migrations/000N_<name>.sql`. Never edit an applied migration.
- **Secrets** (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`) are set with `npx wrangler secret put` and never committed.
- The status page is server-rendered HTML: escape every dynamic value with `esc()` in `src/page.ts`.
- Keep `src/` free of Node-only APIs (it runs on the Workers runtime). Node APIs are fine in `test/`.

## Before finishing a change
```bash
npm test
npm run typecheck
npx wrangler deploy --dry-run --outdir .wrangler/dry   # bundles without uploading
```

## Commits
- Author: the repo owner's git identity. No AI or co-author attribution lines in commit messages.
- Short imperative subject; bullet details in the body when useful.
- Deploy (`npx wrangler deploy`) only after tests and typecheck pass.
