/**
 * Worlds kept in the browser once made, so that going from one place of a world to the next does not
 * make the world again (half a minute) nor its tiles (a second or two each). Kept under the address of
 * the program's own module: in a build its file name carries a hash of its code and of the names of
 * what it loads, the world's worker among them, so a world made by code since changed is never read
 * back. (In development there is no such name, and nothing is kept.) The last three worlds are kept;
 * what cannot be kept (a private window, a full disk) is simply made again.
 */

const DB = 'dungeons-worlds', KEEP = 3;

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => { const db = req.result; db.createObjectStore('worlds'); db.createObjectStore('tiles'); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
}

function ask<T>(db: IDBDatabase, store: string, key: string): Promise<T | undefined> {
  return new Promise((resolve) => {
    try {
      const req = db.transaction(store, 'readonly').objectStore(store).get(key);
      req.onsuccess = () => resolve(req.result as T | undefined);
      req.onerror = () => resolve(undefined);
    } catch { resolve(undefined); }
  });
}

function put(db: IDBDatabase, store: string, key: string, value: unknown): Promise<void> {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch { resolve(); }
  });
}

/** A place in the store for one world made by one version of the code; or nothing, where worlds are not kept. */
export interface WorldShelf {
  get<T>(what: string): Promise<T | undefined>;
  set(what: string, value: unknown): Promise<void>;
}

export async function worldShelf(maker: string, seed: string): Promise<WorldShelf | null> {
  // (Only a build's modules have their code's hash in their names.)
  if (import.meta.env.DEV || typeof indexedDB === 'undefined') return null;
  const db = await open();
  if (!db) return null;
  const key = `${new URL(maker).pathname}|${seed}`;
  return {
    get: <T>(what: string) => ask<T>(db, what === 'world' ? 'worlds' : 'tiles', `${key}|${what}`),
    async set(what: string, value: unknown) {
      await put(db, what === 'world' ? 'worlds' : 'tiles', `${key}|${what}`, value);
      if (what !== 'world') return;
      // (The worlds kept, newest last; beyond the last few, the oldest let go of, with its tiles.)
      const list = ((await ask<string[]>(db, 'worlds', 'kept')) ?? []).filter((k) => k !== key);
      list.push(key);
      for (const old of list.splice(0, Math.max(0, list.length - KEEP))) {
        try {
          const tx = db.transaction(['worlds', 'tiles'], 'readwrite');
          tx.objectStore('worlds').delete(`${old}|world`);
          tx.objectStore('tiles').delete(IDBKeyRange.bound(`${old}|`, `${old}|￿`));
        } catch { /* (left: it does no harm but take room) */ }
      }
      await put(db, 'worlds', 'kept', list);
    },
  };
}
