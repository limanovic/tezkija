import initSqlJs from 'sql.js';

import { BindValue, Db } from './db-types';

/*
 * Web build: expo-sqlite has no straightforward web story, so the same 4 MB
 * quran.db is fetched from the site root and opened in memory with sql.js
 * (SQLite compiled to WebAssembly). Both files are copied into public/ by
 * scripts/prepare-web.js and cached by the service worker, so after the
 * first visit this works offline too.
 */

const DB_URL = '/quran.db';

export async function openDatabase(): Promise<Db> {
  const [SQL, bytes] = await Promise.all([
    initSqlJs({ locateFile: (file) => `/${file}` }),
    fetch(DB_URL).then(async (res) => {
      if (!res.ok) throw new Error(`Could not fetch ${DB_URL}: ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    }),
  ]);
  const db = new SQL.Database(bytes);

  function all<T>(sql: string, params: BindValue[]): T[] {
    const stmt = db.prepare(sql);
    try {
      stmt.bind(params as Parameters<typeof stmt.bind>[0]);
      const rows: T[] = [];
      while (stmt.step()) rows.push(stmt.getAsObject() as T);
      return rows;
    } finally {
      stmt.free();
    }
  }

  return {
    getAllAsync: async (sql, params = []) => all(sql, params),
    getFirstAsync: async (sql, params = []) => all<never>(sql, params)[0] ?? null,
  };
}
