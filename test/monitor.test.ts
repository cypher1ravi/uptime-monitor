import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { checkSite } from "../src/check.ts";
import { findTransitions, formatAlert } from "../src/alert.ts";
import { getStatus, runChecks, type Env } from "../src/monitor.ts";
import { renderStatusPage } from "../src/page.ts";
import { createTestD1 } from "./d1.ts";

let server: Server;
let base = "";
let flakyCalls = 0;
let siteBUp = true;

before(async () => {
  server = createServer((req, res) => {
    if (req.url === "/ok") return res.end("hello world");
    if (req.url === "/error") return ((res.statusCode = 500), res.end("boom"));
    if (req.url === "/slow") return setTimeout(() => res.end("late"), 500);
    if (req.url === "/flaky") return ((res.statusCode = flakyCalls++ === 0 ? 503 : 200), res.end("ok"));
    if (req.url === "/b") return ((res.statusCode = siteBUp ? 200 : 502), res.end("b"));
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

const opts = { timeoutMs: 200, retryDelayMs: 10 };

test("check: up, HTTP error, timeout, and retry on a single blip", async () => {
  const ok = await checkSite({ name: "ok", url: `${base}/ok`, mustContain: "hello" }, opts);
  assert.equal(ok.up, true);
  assert.equal(ok.status_code, 200);

  const err = await checkSite({ name: "err", url: `${base}/error` }, opts);
  assert.equal(err.up, false);
  assert.equal(err.error, "HTTP 500");

  const slow = await checkSite({ name: "slow", url: `${base}/slow` }, opts);
  assert.equal(slow.up, false);
  assert.match(slow.error ?? "", /timeout/);

  const flaky = await checkSite({ name: "flaky", url: `${base}/flaky` }, opts);
  assert.equal(flaky.up, true, "one failed request followed by success must not count as down");
});

test("alerts only fire on state changes", () => {
  const ts = new Date().toISOString();
  const down = { ts, site: "A", url: "u", up: false, status_code: 500, response_ms: 10, error: "HTTP 500" };
  const up = { ...down, site: "B", up: true, status_code: 200, error: null };
  assert.deepEqual(findTransitions([down, up], {}).map((t) => t.result.site), ["A"]);
  assert.equal(findTransitions([down], { A: { up: false, since: ts } }).length, 0);
  const back = findTransitions([{ ...down, up: true, error: null }], {
    A: { up: false, since: new Date(Date.now() - 5 * 60_000).toISOString() },
  });
  assert.match(formatAlert(back[0]), /back UP after 5 min/);
});

test("cron run stores history, tracks state, alerts once per change, and feeds the status page", async () => {
  const db = createTestD1();
  const env = { DB: db as unknown as Env["DB"], CHECK_TIMEOUT_MS: "200", RETRY_DELAY_MS: "10" } as Env;
  const sites = [
    { name: "Site A", url: `${base}/ok` },
    { name: "Site B", url: `${base}/b` },
  ];

  siteBUp = true;
  let run = await runChecks(env, sites);
  assert.equal(run.transitions.length, 0, "first run with everything up is silent");

  siteBUp = false;
  run = await runChecks(env, sites);
  assert.deepEqual(run.transitions.map((t) => t.result.site), ["Site B"]);

  run = await runChecks(env, sites);
  assert.equal(run.transitions.length, 0, "still down: no repeat alert");

  siteBUp = true;
  run = await runChecks(env, sites);
  assert.equal(run.transitions.length, 1);
  assert.equal(run.transitions[0].result.up, true);

  const rows = db.sqlite.prepare("SELECT COUNT(*) AS n FROM checks").get() as { n: number };
  assert.equal(rows.n, 8);

  const status = await getStatus(env, sites);
  const b = status.find((s) => s.site === "Site B")!;
  assert.equal(b.up, true);
  assert.equal(b.uptime_24h, 50);
  assert.equal(status.find((s) => s.site === "Site A")!.uptime_24h, 100);
  assert.equal(b.daily.length, 30);
  assert.equal(b.daily.at(-1)!.uptime, 50);

  const html = renderStatusPage("Test <services>", status);
  assert.match(html, /All systems operational/);
  assert.match(html, /Test &lt;services&gt;/, "title is HTML-escaped");
});

test("hourly run prunes history older than the retention window", async () => {
  const db = createTestD1();
  const env = { DB: db as unknown as Env["DB"], RETENTION_DAYS: "30", CHECK_TIMEOUT_MS: "200", RETRY_DELAY_MS: "10" } as Env;
  db.sqlite
    .prepare("INSERT INTO checks (ts, site, url, up) VALUES (?, 'Old', 'u', 1)")
    .run(new Date(Date.now() - 40 * 86_400_000).toISOString());
  const onTheHour = new Date();
  onTheHour.setUTCMinutes(0);
  await runChecks(env, [{ name: "Site A", url: `${base}/ok` }], onTheHour);
  const old = db.sqlite.prepare("SELECT COUNT(*) AS n FROM checks WHERE site = 'Old'").get() as { n: number };
  assert.equal(old.n, 0);
});
