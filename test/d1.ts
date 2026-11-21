// Minimal D1 stand-in for tests, backed by Node's built-in SQLite (same SQL dialect as D1).
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";

type Param = string | number | null;

export function createTestD1(migrationsDir = new URL("../migrations/", import.meta.url)) {
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort()) {
    db.exec(readFileSync(new URL(f, migrationsDir), "utf8"));
  }

  const prepare = (sql: string) => {
    let params: Param[] = [];
    const isQuery = /^\s*(SELECT|WITH)/i.test(sql);
    const stmt = {
      sql,
      bind(...p: Param[]) {
        const bound = Object.create(stmt) as typeof stmt;
        params = p.map((v) => (v === undefined ? null : v));
        const own = params;
        bound.all = async () => ({ success: true, results: db.prepare(sql).all(...own), meta: {} });
        bound.run = async () => {
          if (isQuery) return bound.all();
          const r = db.prepare(sql).run(...own);
          return { success: true, results: [], meta: { changes: Number(r.changes) } };
        };
        return bound;
      },
      async all() {
        return { success: true, results: db.prepare(sql).all(...params), meta: {} };
      },
      async first(col?: string) {
        const row = db.prepare(sql).get(...params) as Record<string, unknown> | undefined;
        return col ? (row?.[col] ?? null) : (row ?? null);
      },
      async run(): Promise<{ success: boolean; results: unknown[]; meta: Record<string, unknown> }> {
        if (isQuery) return stmt.all();
        const r = db.prepare(sql).run(...params);
        return { success: true, results: [], meta: { changes: Number(r.changes) } };
      },
    };
    return stmt;
  };

  return {
    prepare,
    async batch(stmts: { run(): Promise<unknown> }[]) {
      const out = [];
      for (const s of stmts) out.push(await s.run());
      return out;
    },
    sqlite: db,
  };
}
