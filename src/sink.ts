import { PubSub } from "@google-cloud/pubsub";
import { config } from "./config.ts";
import type { CheckResult } from "./check.ts";

export interface Sink {
  send(results: CheckResult[]): Promise<void>;
}

class LogSink implements Sink {
  async send(results: CheckResult[]) {
    for (const r of results) {
      const status = r.up ? "UP  " : "DOWN";
      console.log(`[${status}] ${r.site.padEnd(20)} ${String(r.status_code ?? "-").padEnd(4)} ${r.response_ms ?? "-"} ms ${r.error ?? ""}`);
    }
  }
}

/** Publishes each result; a BigQuery subscription on the topic stores them (see infra/setup-gcp.md). */
class PubSubSink implements Sink {
  private topic = new PubSub().topic(config.pubsubTopic);
  async send(results: CheckResult[]) {
    await Promise.all(results.map((r) => this.topic.publishMessage({ json: r })));
  }
}

export const createSink = (): Sink => (config.sink === "pubsub" ? new PubSubSink() : new LogSink());
