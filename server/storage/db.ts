import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema';

export type Db = BetterSQLite3Database<typeof schema>;

const MIGRATIONS = fileURLToPath(new URL('./migrations', import.meta.url));

/** Opens (or creates) the database and brings its schema up to date; throws when the file is unusable. */
export function openDatabase(path: string): { db: Db; close: () => void } {
  const sqlite = new Database(path);
  try {
    // WAL lets other programs read the file while the server writes.
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('foreign_keys = ON');
    const db = drizzle(sqlite, { schema });
    migrate(db, { migrationsFolder: MIGRATIONS });
    return { db, close: () => sqlite.close() };
  } catch (error) {
    sqlite.close();
    throw error;
  }
}
