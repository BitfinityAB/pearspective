import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { openDatabase } from '../db';

const TABLES = ['change_requests', 'checks', 'meta', 'not_tickets', 'people', 'review_requests', 'review_threads', 'reviews', 'status_categories', 'tickets', 'viewer_teams', 'views'];
const tempFile = (name = 'pearspective.db') => join(mkdtempSync(join(tmpdir(), 'pearspective-db-')), name);

describe('openDatabase', () => {
  it('creates every table in an empty file, with WAL and foreign keys on', () => {
    const path = tempFile();
    const { close } = openDatabase(path);
    close();
    const raw = new Database(path, { readonly: true });
    const names = raw.prepare("select name from sqlite_master where type = 'table'").all().map((row: any) => row.name);
    expect(names).toEqual(expect.arrayContaining(TABLES));
    expect(raw.pragma('journal_mode', { simple: true })).toBe('wal');
    raw.close();
  });

  it('turns foreign keys on for its own connection', () => {
    const { db, close } = openDatabase(':memory:');
    expect((db as any).$client.pragma('foreign_keys', { simple: true })).toBe(1);
    close();
  });

  it('can be opened again without re-running migrations', () => {
    const path = tempFile();
    openDatabase(path).close();
    expect(() => openDatabase(path).close()).not.toThrow();
  });

  it('throws for a file that is not a database', () => {
    const path = tempFile('broken.db');
    writeFileSync(path, 'this is not a database file, just some text that is long enough');
    expect(() => openDatabase(path)).toThrow();
  });
});
