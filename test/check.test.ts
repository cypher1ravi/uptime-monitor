import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { checkSite } from "../src/check.ts";
import { findTransitions, formatAlert } from "../src/alert.ts";

let server: Server;
let base = "";
let flakyCalls = 0;

before(async () => {
  server = createServer((req, res) => {
    if (req.url === "/ok") return res.end("hello world");
    if (req.url === "/error") return (res.statusCode = 500), res.end("boom");
    if (req.url === "/slow") return setTimeout(() => res.end("late"), 500);
    if (req.url === "/flaky") return (res.statusCode = flakyCalls++ === 0 ? 503 : 200), res.end("ok");
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

const opts = { timeoutMs: 200, retryDelayMs: 10 };

test("up site", async () => {
  const r = await checkSite({ name: "ok", url: `${base}/ok`, mustContain: "hello" }, opts);
  assert.equal(r.up, true);
  assert.equal(r.status_code, 200);
  assert.ok(r.response_ms !== null && r.response_ms >= 0);
});

test("HTTP 500 is down", async () => {
  const r = await checkSite({ name: "err", url: `${base}/error` }, opts);
  assert.equal(r.up, false);
  assert.equal(r.error, "HTTP 500");
});

test("timeout is down", async () => {
  const r = await checkSite({ name: "slow", url: `${base}/slow` }, opts);
  assert.equal(r.up, false);
  assert.match(r.error ?? "", /timeout/);
});

test("one failed request then success is not reported as down (retry)", async () => {
  const r = await checkSite({ name: "flaky", url: `${base}/flaky` }, opts);
  assert.equal(r.up, true);
});

test("alerts only on state changes", () => {
  const ts = new Date().toISOString();
  const down = { ts, site: "A", url: "u", up: false, status_code: 500, response_ms: 10, error: "HTTP 500" };
  const up = { ...down, site: "B", up: true, status_code: 200, error: null };

  // First-ever check: only the down site alerts
  assert.deepEqual(findTransitions([down, up], {}).map((t) => t.result.site), ["A"]);
  // Already known down -> no repeat alert
  assert.equal(findTransitions([down], { A: { up: false, since: ts } }).length, 0);
  // Recovery alerts, with the outage duration
  const back = findTransitions([{ ...down, up: true, error: null }], { A: { up: false, since: new Date(Date.now() - 5 * 60_000).toISOString() } });
  assert.equal(back.length, 1);
  assert.match(formatAlert(back[0]), /back UP after 5 min/);
});
