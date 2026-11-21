// Local development only: run a check every minute, like Cloud Scheduler does in production.
import { runOnce } from "./run.ts";

const INTERVAL_MS = Number(process.env.DEV_INTERVAL_MS ?? 60_000);

async function tick() {
  console.log(`\n--- ${new Date().toLocaleTimeString()} ---`);
  try {
    await runOnce();
  } catch (err) {
    console.error(err);
  }
}

await tick();
setInterval(tick, INTERVAL_MS);
