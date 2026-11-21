import type { CheckResult } from "./check.ts";

export type SiteState = { up: boolean; since: string };
export type Transition = { result: CheckResult; previous: SiteState | undefined };

/** Only "went down" and "recovered" are alert-worthy. The first ever check of an up site is silent. */
export function findTransitions(results: CheckResult[], state: Record<string, SiteState>): Transition[] {
  return results
    .map((result) => ({ result, previous: state[result.site] }))
    .filter(({ result, previous }) => (previous ? previous.up !== result.up : !result.up));
}

export function formatDuration(fromIso: string, toIso: string) {
  const mins = Math.max(1, Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 60_000));
  return mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)} h ${mins % 60} min`;
}

export function formatAlert({ result, previous }: Transition) {
  if (!result.up) return `🔴 ${result.site} is DOWN\n${result.url}\nReason: ${result.error}`;
  const downFor = previous ? ` after ${formatDuration(previous.since, result.ts)}` : "";
  return `🟢 ${result.site} is back UP${downFor}\n${result.url}\nResponse: ${result.response_ms} ms`;
}

/** Sends to Telegram if configured (free); otherwise logs. Create a bot with @BotFather. */
export async function sendAlert(text: string, token?: string, chatId?: string) {
  if (!token || !chatId) {
    console.log(`[alert] ${text.replace(/\n/g, " | ")}`);
    return;
  }
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
  });
  if (!res.ok) console.error(`[alert] Telegram error ${res.status}: ${await res.text()}`);
}
