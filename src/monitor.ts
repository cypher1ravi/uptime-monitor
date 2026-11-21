import type { D1Database } from "@cloudflare/workers-types";
import { checkSite, type CheckResult, type Site } from "./check.ts";
import { findTransitions, formatAlert, sendAlert, type SiteState } from "./alert.ts";

export type Env = {
  DB: D1Database;
  STATUS_PAGE_TITLE?: string;
  CHECK_TIMEOUT_MS?: string;
  RETRY_DELAY_MS?: string;
  RETENTION_DAYS?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
};

/** One monitoring run (called by the cron trigger every minute). */
export async function runChecks(env: Env, sites: Site[], now = new Date()) {
  const opts = { timeoutMs: Number(env.CHECK_TIMEOUT_MS ?? 10_000), retryDelayMs: Number(env.RETRY_DELAY_MS ?? 3_000) };
  const results = await Promise.all(sites.map((s) => checkSite(s, opts)));

  const stateRows = await env.DB.prepare("SELECT site, up, since FROM state").all<{ site: string; up: number; since: string }>();
  const state: Record<string, SiteState> = Object.fromEntries(stateRows.results.map((r) => [r.site, { up: r.up === 1, since: r.since }]));
  const transitions = findTransitions(results, state);

  const insert = env.DB.prepare(
    "INSERT INTO checks (ts, site, url, up, status_code, response_ms, error) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
  );
  const upsert = env.DB.prepare(
    "INSERT INTO state (site, up, since) VALUES (?1, ?2, ?3) ON CONFLICT(site) DO UPDATE SET up = excluded.up, since = excluded.since",
  );
  const changed = results.filter((r) => !state[r.site] || state[r.site].up !== r.up);

  const statements = [
    ...results.map((r: CheckResult) => insert.bind(r.ts, r.site, r.url, r.up ? 1 : 0, r.status_code, r.response_ms, r.error)),
    ...changed.map((r) => upsert.bind(r.site, r.up ? 1 : 0, r.ts)),
  ];
  // Once an hour, drop history older than RETENTION_DAYS (keeps the free 500 MB database small).
  if (now.getUTCMinutes() === 0) {
    const cutoff = new Date(now.getTime() - Number(env.RETENTION_DAYS ?? 90) * 86_400_000).toISOString();
    statements.push(env.DB.prepare("DELETE FROM checks WHERE ts < ?1").bind(cutoff));
  }
  await env.DB.batch(statements);

  await Promise.all(transitions.map((t) => sendAlert(formatAlert(t), env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID)));
  return { results, transitions };
}

export type SiteStatus = {
  site: string;
  url: string;
  up: boolean | null;
  since: string | null;
  last_checked: string | null;
  last_response_ms: number | null;
  uptime_24h: number | null;
  uptime_7d: number | null;
  uptime_30d: number | null;
  avg_ms_24h: number | null;
  /** Last 30 days, one entry per day: uptime % or null when there is no data. */
  daily: { day: string; uptime: number | null }[];
};

/** Data for the status page and /api/status. */
export async function getStatus(env: Env, sites: Site[], now = new Date()): Promise<SiteStatus[]> {
  const ago = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();
  const pct = (up: number | null, total: number | null) => (total ? Math.round((10_000 * (up ?? 0)) / total) / 100 : null);

  return Promise.all(
    sites.map(async (s) => {
      const [summary, last, state, daily] = await env.DB.batch<Record<string, unknown>>([
        env.DB.prepare(
          `SELECT
             SUM(CASE WHEN ts >= ?2 THEN up END) AS up24, SUM(CASE WHEN ts >= ?2 THEN 1 END) AS n24,
             SUM(CASE WHEN ts >= ?3 THEN up END) AS up7,  SUM(CASE WHEN ts >= ?3 THEN 1 END) AS n7,
             SUM(up) AS up30, COUNT(*) AS n30,
             AVG(CASE WHEN ts >= ?2 AND up = 1 THEN response_ms END) AS avg24
           FROM checks WHERE site = ?1 AND ts >= ?4`,
        ).bind(s.name, ago(1), ago(7), ago(30)),
        env.DB.prepare("SELECT ts, response_ms FROM checks WHERE site = ?1 ORDER BY ts DESC LIMIT 1").bind(s.name),
        env.DB.prepare("SELECT up, since FROM state WHERE site = ?1").bind(s.name),
        env.DB.prepare(
          "SELECT substr(ts, 1, 10) AS day, SUM(up) AS up, COUNT(*) AS n FROM checks WHERE site = ?1 AND ts >= ?2 GROUP BY day",
        ).bind(s.name, ago(30)),
      ]);

      const m = (summary.results[0] ?? {}) as Record<string, number | null>;
      const l = last.results[0] as { ts: string; response_ms: number | null } | undefined;
      const st = state.results[0] as { up: number; since: string } | undefined;
      const byDay = new Map((daily.results as { day: string; up: number; n: number }[]).map((d) => [d.day, pct(d.up, d.n)]));

      const days: SiteStatus["daily"] = [];
      for (let i = 29; i >= 0; i--) {
        const day = new Date(now.getTime() - i * 86_400_000).toISOString().slice(0, 10);
        days.push({ day, uptime: byDay.get(day) ?? null });
      }

      return {
        site: s.name,
        url: s.url,
        up: st ? st.up === 1 : null,
        since: st?.since ?? null,
        last_checked: l?.ts ?? null,
        last_response_ms: l?.response_ms ?? null,
        uptime_24h: pct(m.up24, m.n24),
        uptime_7d: pct(m.up7, m.n7),
        uptime_30d: pct(m.up30, m.n30),
        avg_ms_24h: m.avg24 == null ? null : Math.round(m.avg24),
        daily: days,
      };
    }),
  );
}
