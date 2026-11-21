import type { SiteStatus } from "./monitor.ts";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const fmtPct = (v: number | null) => (v == null ? "—" : `${v.toFixed(2)}%`);

function barColor(uptime: number | null) {
  if (uptime == null) return "var(--empty)";
  if (uptime >= 99.5) return "var(--up)";
  if (uptime >= 95) return "var(--warn)";
  return "var(--down)";
}

/** Server-rendered public status page: no JavaScript framework, loads instantly. */
export function renderStatusPage(title: string, sites: SiteStatus[], now = new Date()) {
  const allUp = sites.every((s) => s.up !== false);
  const anyData = sites.some((s) => s.up !== null);
  const banner = !anyData ? "Collecting first results…" : allUp ? "All systems operational" : "Some services are down";

  const rows = sites
    .map((s) => {
      const state = s.up == null ? "pending" : s.up ? "up" : "down";
      const label = s.up == null ? "Pending" : s.up ? "Operational" : "Down";
      const bars = s.daily
        .map((d) => `<span class="bar" style="background:${barColor(d.uptime)}" title="${d.day}: ${fmtPct(d.uptime)}"></span>`)
        .join("");
      return `
      <section class="card">
        <div class="row">
          <div>
            <h2><span class="dot ${state}"></span>${esc(s.site)}</h2>
            <a class="url" href="${esc(s.url)}" rel="noopener" target="_blank">${esc(s.url.replace(/^https?:\/\//, ""))}</a>
          </div>
          <span class="badge ${state}">${label}</span>
        </div>
        <div class="bars" aria-label="Uptime per day, last 30 days">${bars}</div>
        <div class="legend"><span>30 days ago</span><span>Today</span></div>
        <dl class="stats">
          <div><dt>24 hours</dt><dd>${fmtPct(s.uptime_24h)}</dd></div>
          <div><dt>7 days</dt><dd>${fmtPct(s.uptime_7d)}</dd></div>
          <div><dt>30 days</dt><dd>${fmtPct(s.uptime_30d)}</dd></div>
          <div><dt>Avg response</dt><dd>${s.avg_ms_24h == null ? "—" : `${s.avg_ms_24h} ms`}</dd></div>
        </dl>
      </section>`;
    })
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="60">
<title>${esc(title)} — Status</title>
<meta name="description" content="Live uptime and response times for ${esc(title)}.">
<style>
  :root { --bg:#f6f0e4; --card:#fffaf2; --ink:#2a2826; --muted:#6b655d; --line:#e2d5bd;
          --up:#2f9e5b; --warn:#e8a10c; --down:#d64545; --empty:#e2d5bd; --accent:#e8590c; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#1d1b19; --card:#262320; --ink:#efe9de; --muted:#a39b8f; --line:#3a3632; --empty:#3a3632; }
  }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--ink); font:15px/1.5 system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }
  main { max-width: 760px; margin: 0 auto; padding: 48px 16px; }
  h1 { font-size: 28px; margin: 0 0 4px; }
  .sub { color: var(--muted); margin: 0 0 24px; }
  .banner { padding: 14px 18px; border-radius: 12px; font-weight: 600; margin-bottom: 20px; color: #fff;
            background: ${!anyData ? "var(--muted)" : allUp ? "var(--up)" : "var(--down)"}; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 18px; margin-bottom: 14px; }
  .row { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
  h2 { font-size: 17px; margin: 0; display: flex; align-items: center; gap: 8px; }
  .url { color: var(--muted); font-size: 13px; text-decoration: none; word-break: break-all; }
  .url:hover { color: var(--accent); }
  .dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
  .dot.up { background: var(--up); } .dot.down { background: var(--down); } .dot.pending { background: var(--muted); }
  .badge { font-size: 12px; font-weight: 600; padding: 3px 10px; border-radius: 999px; white-space: nowrap; }
  .badge.up { background: color-mix(in srgb, var(--up) 15%, transparent); color: var(--up); }
  .badge.down { background: color-mix(in srgb, var(--down) 15%, transparent); color: var(--down); }
  .badge.pending { background: var(--line); color: var(--muted); }
  .bars { display: grid; grid-template-columns: repeat(30, 1fr); gap: 3px; margin-top: 16px; height: 32px; }
  .bar { border-radius: 3px; }
  .legend { display: flex; justify-content: space-between; color: var(--muted); font-size: 12px; margin-top: 6px; }
  .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 14px 0 0; }
  .stats dt { color: var(--muted); font-size: 12px; } .stats dd { margin: 0; font-weight: 600; font-variant-numeric: tabular-nums; }
  @media (max-width: 520px) { .stats { grid-template-columns: repeat(2, 1fr); } }
  footer { color: var(--muted); font-size: 13px; margin-top: 24px; text-align: center; }
  footer a { color: inherit; }
</style>
</head>
<body>
<main>
  <h1>${esc(title)}</h1>
  <p class="sub">Checked every minute from Cloudflare's network.</p>
  <div class="banner">${banner}</div>
  ${rows}
  <footer>Updated ${now.toISOString().replace("T", " ").slice(0, 16)} UTC · <a href="/api/status">JSON API</a> ·
  <a href="https://github.com/cypher1ravi/uptime-monitor">Source on GitHub</a></footer>
</main>
</body>
</html>`;
}
