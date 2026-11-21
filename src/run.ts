// One monitoring run: check every site, store results, alert on changes.
// Runs as a Cloud Run job triggered by Cloud Scheduler every minute.
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkSite } from "./check.ts";
import { config, loadSites } from "./config.ts";
import { findTransitions, formatAlert, sendAlert } from "./alert.ts";
import { createSink } from "./sink.ts";
import { createStateStore, type StateMap } from "./state.ts";

export async function runOnce() {
  const sites = loadSites();
  const results = await Promise.all(sites.map((s) => checkSite(s, config)));

  const store = createStateStore();
  const state = await store.load();
  const transitions = findTransitions(results, state);

  await createSink().send(results);
  await Promise.all(transitions.map((t) => sendAlert(formatAlert(t))));

  const changes: StateMap = {};
  for (const r of results) {
    if (!state[r.site] || state[r.site].up !== r.up) changes[r.site] = { up: r.up, since: r.ts };
  }
  if (Object.keys(changes).length) await store.save(changes);

  return { results, transitions };
}

// Run when executed directly (not when imported by the dev loop or tests).
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runOnce().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
