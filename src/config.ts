import { readFileSync } from "node:fs";

export type Site = {
  name: string;
  url: string;
  /** Expected HTTP status. Default: any 2xx/3xx counts as up. */
  expectStatus?: number;
  /** Optional text that must appear in the response body. */
  mustContain?: string;
};

export const config = {
  /** "log" prints results (local dev). "pubsub" publishes them to Pub/Sub -> BigQuery. */
  sink: (process.env.SINK ?? "log") as "log" | "pubsub",
  pubsubTopic: process.env.PUBSUB_TOPIC ?? "uptime-checks",

  /** "file" keeps last-known state in .state.json (dev). "firestore" in production. */
  stateStore: (process.env.STATE_STORE ?? "file") as "file" | "firestore",

  timeoutMs: Number(process.env.CHECK_TIMEOUT_MS ?? 10_000),
  /** Retry a failed check once after this delay before calling a site "down" (avoids false alarms). */
  retryDelayMs: Number(process.env.RETRY_DELAY_MS ?? 3_000),

  telegramToken: process.env.TELEGRAM_BOT_TOKEN ?? "",
  telegramChatId: process.env.TELEGRAM_CHAT_ID ?? "",

  sitesFile: process.env.SITES_FILE ?? new URL("../sites.json", import.meta.url),
};

export function loadSites(): Site[] {
  return JSON.parse(readFileSync(config.sitesFile, "utf8"));
}
