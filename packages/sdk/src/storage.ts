// Pluggable key-value storage for what a client keeps between launches:
// the outbox of unsent messages, the cached conversation list and
// message history, the signed-in user. One small interface for every
// platform — the SDK ships an in-memory one and an IndexedDB one for
// browsers; React Native apps hand in MMKV, AsyncStorage or SQLite
// behind the same three calls.
//
// Every key a client writes starts with its namespace (server + user),
// so two clients sharing one storage never see each other's data, and
// `destroy({ clearStorage: true })` removes exactly one client's keys.

/**
 * Where a client persists data. Sync or async (promise-returning)
 * methods both work; values are opaque strings (JSON).
 *
 * React Native with MMKV:
 *
 * ```ts
 * const mmkv = new MMKV({ id: 'poolse' });
 * const storage: PoolseStorage = {
 *   get: (k) => mmkv.getString(k) ?? null,
 *   set: (k, v) => mmkv.set(k, v),
 *   remove: (k) => mmkv.delete(k),
 * };
 * ```
 *
 * With AsyncStorage: `{ get: AsyncStorage.getItem, set: AsyncStorage.setItem,
 * remove: AsyncStorage.removeItem }`.
 */
export interface PoolseStorage {
  get: (key: string) => string | null | undefined | Promise<string | null | undefined>;
  set: (key: string, value: string) => void | Promise<void>;
  remove: (key: string) => void | Promise<void>;
}

/** A storage that lives in memory only — the default for tests and SSR. */
export function memoryStorage(): PoolseStorage & { readonly size: number } {
  const map = new Map<string, string>();
  return {
    get: (k) => map.get(k) ?? null,
    set: (k, v) => {
      map.set(k, v);
    },
    remove: (k) => {
      map.delete(k);
    },
    get size() {
      return map.size;
    },
  };
}

export interface IndexedDbStorageOptions {
  /** Database name. Default `'poolse'`. */
  dbName?: string;
  /** Object store name. Default `'kv'`. */
  storeName?: string;
  /** Override `globalThis.indexedDB` (tests, workers). */
  indexedDB?: IDBFactory;
}

/**
 * A {@link PoolseStorage} on IndexedDB, for browsers and desktop
 * webviews (Tauri, Electron). Falls back to memory when IndexedDB is
 * missing or refuses to open (private mode, blocked storage), so a
 * client always works — it just forgets on reload.
 *
 * ```ts
 * const chat = new Poolse({ apiUrl, getToken, storage: createIndexedDbStorage() });
 * ```
 */
export function createIndexedDbStorage(opts: IndexedDbStorageOptions = {}): PoolseStorage {
  const factory =
    opts.indexedDB ?? (globalThis as { indexedDB?: IDBFactory }).indexedDB ?? undefined;
  const dbName = opts.dbName ?? 'poolse';
  const storeName = opts.storeName ?? 'kv';
  const fallback = memoryStorage();
  if (!factory) return fallback;

  let dbPromise: Promise<IDBDatabase | null> | null = null;
  const open = (): Promise<IDBDatabase | null> => {
    dbPromise ??= new Promise<IDBDatabase | null>((resolve) => {
      let req: IDBOpenDBRequest;
      try {
        req = factory.open(dbName, 1);
      } catch {
        resolve(null);
        return;
      }
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(storeName)) {
          req.result.createObjectStore(storeName);
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        // A connection the browser closes (WebKit drops them) or a newer
        // version needs is reopened on next use, instead of every later
        // call falling back to memory for the rest of the session.
        db.onclose = () => {
          dbPromise = null;
        };
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        resolve(db);
      };
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    });
    return dbPromise;
  };

  const run = async <T>(
    mode: IDBTransactionMode,
    fn: (store: IDBObjectStore) => IDBRequest<T>,
    orElse: () => T | Promise<T>,
  ): Promise<T> => {
    const db = await open();
    if (!db) return orElse();
    return new Promise<T>((resolve) => {
      try {
        const tx = db.transaction(storeName, mode);
        const req = fn(tx.objectStore(storeName));
        if (mode === 'readonly') {
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(orElse() as T);
        } else {
          // A write counts once its transaction commits; one that aborts
          // afterwards (quota) is not saved.
          tx.oncomplete = () => resolve(req.result);
          tx.onabort = () => resolve(orElse() as T);
          tx.onerror = () => resolve(orElse() as T);
        }
      } catch {
        // The connection is gone (InvalidStateError): open a new one next time.
        dbPromise = null;
        resolve(orElse() as T);
      }
    });
  };

  return {
    get: (key) =>
      run<unknown>(
        'readonly',
        (s) => s.get(key),
        () => fallback.get(key),
      ).then((v) => (typeof v === 'string' ? v : null)),
    set: (key, value) =>
      run<IDBValidKey>(
        'readwrite',
        (s) => s.put(value, key),
        () => {
          void fallback.set(key, value);
          return key;
        },
      ).then(() => undefined),
    remove: (key) =>
      run<undefined>(
        'readwrite',
        (s) => s.delete(key),
        () => {
          void fallback.remove(key);
          return undefined;
        },
      ).then(() => undefined),
  };
}

/**
 * One client's slice of a storage: every key is prefixed with the
 * namespace, and the keys written are remembered (in an index entry)
 * so `clear()` can remove them on a storage that can't list keys.
 *
 * @internal
 */
export class ScopedStorage {
  private index: Set<string> | null = null;
  private indexLoad: Promise<Set<string>> | null = null;

  constructor(
    private readonly storage: PoolseStorage,
    /** E.g. `poolse:v1:https://chat.acme.example#<user id>`. */
    public readonly prefix: string,
  ) {}

  async getJson<T>(name: string): Promise<T | null> {
    try {
      const raw = await this.storage.get(this.key(name));
      if (!raw) return null;
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async setJson(name: string, value: unknown): Promise<void> {
    try {
      await this.storage.set(this.key(name), JSON.stringify(value));
      await this.remember(name);
    } catch {
      // Full or blocked: the in-memory copy still works for this session.
    }
  }

  async remove(name: string): Promise<void> {
    try {
      await this.storage.remove(this.key(name));
    } catch {
      // ignore
    }
  }

  /** Remove every key this namespace wrote. */
  async clear(): Promise<void> {
    const index = await this.loadIndex();
    for (const name of index) await this.remove(name);
    index.clear();
    await this.remove(INDEX);
  }

  private key(name: string): string {
    return `${this.prefix}:${name}`;
  }

  private async remember(name: string): Promise<void> {
    const index = await this.loadIndex();
    if (index.has(name)) return;
    index.add(name);
    try {
      await this.storage.set(this.key(INDEX), JSON.stringify([...index]));
    } catch {
      // ignore
    }
  }

  private loadIndex(): Promise<Set<string>> {
    if (this.index) return Promise.resolve(this.index);
    this.indexLoad ??= (async () => {
      let names: string[] = [];
      try {
        const raw = await this.storage.get(this.key(INDEX));
        const parsed: unknown = raw ? JSON.parse(raw) : [];
        if (Array.isArray(parsed)) names = parsed.filter((n): n is string => typeof n === 'string');
      } catch {
        // A broken index: start over.
      }
      this.index = new Set(names);
      return this.index;
    })();
    return this.indexLoad;
  }
}

const INDEX = '__index';
