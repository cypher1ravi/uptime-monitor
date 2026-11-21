import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { Firestore } from "@google-cloud/firestore";
import { config } from "./config.ts";

/** Last known status per site, so alerts fire only when a site goes down or comes back. */
export type SiteState = { up: boolean; since: string };
export type StateMap = Record<string, SiteState>;

export interface StateStore {
  load(): Promise<StateMap>;
  save(changes: StateMap): Promise<void>;
}

/** Local development: a JSON file next to the project. */
class FileStateStore implements StateStore {
  private file = ".state.json";
  async load() {
    return existsSync(this.file) ? (JSON.parse(readFileSync(this.file, "utf8")) as StateMap) : {};
  }
  async save(changes: StateMap) {
    writeFileSync(this.file, JSON.stringify({ ...(await this.load()), ...changes }, null, 2));
  }
}

/**
 * Production: one Firestore document. Read once per run (480 reads/day for 3-minute checks),
 * written only when something changes, well inside Firestore's free daily quota.
 */
class FirestoreStateStore implements StateStore {
  private doc = new Firestore().collection("uptime").doc("state");
  async load() {
    const snap = await this.doc.get();
    return (snap.data() as StateMap | undefined) ?? {};
  }
  async save(changes: StateMap) {
    await this.doc.set(changes, { merge: true });
  }
}

export const createStateStore = (): StateStore =>
  config.stateStore === "firestore" ? new FirestoreStateStore() : new FileStateStore();
