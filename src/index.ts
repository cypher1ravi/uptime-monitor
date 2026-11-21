import { Hono } from "hono";
import { cors } from "hono/cors";
import type { ExecutionContext, ScheduledController } from "@cloudflare/workers-types";
import sitesJson from "../sites.json";
import type { Site } from "./check.ts";
import { getStatus, runChecks, type Env } from "./monitor.ts";
import { renderStatusPage } from "./page.ts";

const sites = sitesJson as Site[];
const app = new Hono<{ Bindings: Env }>();

app.get("/", async (c) => {
  const status = await getStatus(c.env, sites);
  c.header("cache-control", "public, max-age=30");
  return c.html(renderStatusPage(c.env.STATUS_PAGE_TITLE ?? "Status", status));
});

app.use("/api/*", cors({ origin: "*", allowMethods: ["GET"] }));
app.get("/api/status", async (c) => {
  c.header("cache-control", "public, max-age=30");
  return c.json({ updated: new Date().toISOString(), sites: await getStatus(c.env, sites) });
});

app.get("/healthz", (c) => c.json({ ok: true }));

export default {
  fetch: app.fetch,
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      runChecks(env, sites).then(({ results }) =>
        console.log(results.map((r) => `${r.up ? "UP" : "DOWN"} ${r.site} ${r.response_ms ?? "-"}ms`).join(" | ")),
      ),
    );
  },
};
