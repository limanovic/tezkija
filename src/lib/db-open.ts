import { Asset } from 'expo-asset';
import { Directory, File, Paths } from 'expo-file-system';
import * as SQLite from 'expo-sqlite';

import { Db } from './db-types';

// Bump the name whenever the bundled database changes shape — the copy runs
// once per install, so existing installs only pick up a new file under a new
// name. Older copies are deleted below.
const DB_NAME = 'tezkija.v3.db';
const OLD_DB_NAMES: string[] = ['tezkija.v1.db', 'tezkija.v2.db'];

/**
 * expo-sqlite cannot open a database straight from the asset bundle, so on
 * first launch we copy the bundled quran.db into the app's document
 * directory under SQLite/ (where openDatabaseAsync looks for it). The copy
 * runs at most once per install: if the file already exists we skip it.
 * The database is treated as read-only — we never write to it.
 */
async function copyDatabaseIfNeeded(): Promise<void> {
  const sqliteDir = new Directory(Paths.document, 'SQLite');
  if (!sqliteDir.exists) {
    sqliteDir.create({ intermediates: true });
  }
  for (const oldName of OLD_DB_NAMES) {
    const oldFile = new File(sqliteDir, oldName);
    if (oldFile.exists) oldFile.delete();
  }
  const dbFile = new File(sqliteDir, DB_NAME);
  if (dbFile.exists) return;

  const asset = Asset.fromModule(require('../../assets/quran.db'));
  await asset.downloadAsync(); // resolves the asset to a local file:// URI
  if (!asset.localUri) {
    throw new Error('Could not resolve bundled quran.db asset');
  }
  new File(asset.localUri).copy(dbFile);
}

/** Open (and on first call, copy) the bundled database. */
export async function openDatabase(): Promise<Db> {
  await copyDatabaseIfNeeded();
  const db = await SQLite.openDatabaseAsync(DB_NAME);
  return {
    getAllAsync: (sql, params = []) => db.getAllAsync(sql, params),
    getFirstAsync: (sql, params = []) => db.getFirstAsync(sql, params),
  };
}
