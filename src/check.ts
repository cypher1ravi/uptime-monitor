export type Site = {
  name: string;
  url: string;
  /** Expected HTTP status. Default: any status below 400 counts as up. */
  expectStatus?: number;
  /** Optional text that must appear in the response body. */
  mustContain?: string;
};

export type CheckResult = {
  ts: string;
  site: string;
  url: string;
  up: boolean;
  status_code: number | null;
  response_ms: number | null;
  error: string | null;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function checkOnce(site: Site, timeoutMs: number): Promise<CheckResult> {
  const started = Date.now();
  const base = { ts: new Date().toISOString(), site: site.name, url: site.url };
  try {
    const res = await fetch(site.url, {
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "user-agent": "uptime-monitor/0.2 (+https://github.com/cypher1ravi/uptime-monitor)" },
    });
    const body = site.mustContain ? await res.text() : (await res.body?.cancel(), "");
    const response_ms = Date.now() - started;

    const statusOk = site.expectStatus ? res.status === site.expectStatus : res.status < 400;
    const textOk = !site.mustContain || body.includes(site.mustContain);
    const up = statusOk && textOk;
    const error = up ? null : !statusOk ? `HTTP ${res.status}` : `missing text "${site.mustContain}"`;
    return { ...base, up, status_code: res.status, response_ms, error };
  } catch (err) {
    const e = err as Error;
    const error = e.name === "TimeoutError" || e.name === "AbortError" ? `timeout after ${timeoutMs} ms` : e.message;
    return { ...base, up: false, status_code: null, response_ms: null, error };
  }
}

/** Check a site; if it fails, wait and retry once so a single blip doesn't trigger an alert. */
export async function checkSite(site: Site, opts: { timeoutMs: number; retryDelayMs: number }): Promise<CheckResult> {
  const first = await checkOnce(site, opts.timeoutMs);
  if (first.up) return first;
  await sleep(opts.retryDelayMs);
  return checkOnce(site, opts.timeoutMs);
}
