/**
 * On-device search for end-to-end encrypted notes (NT7). The server can't
 * index them, so each device keeps a small word index of the notes it has
 * decrypted and stores it encrypted under a key derived from the account
 * key (`seal` / `NoteSearchIndex.open`).
 *
 * Matching follows the server's note search: every query word must match
 * (as a prefix of a word in the note), case and accents ignored. Results
 * rank title matches and whole-word matches first, then the newest.
 *
 * Sealed index (an item envelope, kind 1):
 *   encryptBytes(HKDF(accountKey, "key/search-index") as item key v1,
 *                JSON {v: 1, docs}, {itemId: "search-index", slot: <name>})
 */
import { fromUtf8, utf8 } from './bytes';
import { PoolseCryptoError } from './errors';
import { DOMAIN } from './format';
import { decryptBytes, encryptBytes } from './item';
import { type AccountKey, ItemKey, secretOf } from './keys';
import { hkdf, label } from './subtle';

/** Longest word kept; longer runs are cut. */
const MAX_WORD = 40;
/** Most distinct words kept per note. */
const MAX_WORDS_PER_NOTE = 5000;

/** Lowercased, accent-free words of `text` (letters and digits). */
export function searchWords(text: string): string[] {
  const norm = text
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase();
  const out: string[] = [];
  for (const m of norm.matchAll(/[\p{L}\p{N}]+/gu)) out.push(m[0].slice(0, MAX_WORD));
  return out;
}

/** What one note contributes to the index. */
export interface SearchDocument {
  title: string;
  /** Plain text of the body (and anything else searchable: tags, attachment names). */
  text: string;
  /** For ordering ties: ISO time or ms. */
  updatedAt?: string | number;
}

interface Doc {
  t: string[];
  w: string[];
  u: number;
}

export interface SearchHit {
  id: string;
  score: number;
}

export class NoteSearchIndex {
  #docs = new Map<string, Doc>();

  /** Notes in the index. */
  get size(): number {
    return this.#docs.size;
  }

  /** Add or replace a note. */
  put(id: string, doc: SearchDocument): void {
    const t = unique(searchWords(doc.title));
    const w = unique([...t, ...searchWords(doc.text)]).slice(0, MAX_WORDS_PER_NOTE);
    const u =
      typeof doc.updatedAt === 'number'
        ? doc.updatedAt
        : doc.updatedAt
          ? Date.parse(doc.updatedAt) || 0
          : 0;
    this.#docs.set(id, { t, w, u });
  }

  remove(id: string): void {
    this.#docs.delete(id);
  }

  has(id: string): boolean {
    return this.#docs.has(id);
  }

  clear(): void {
    this.#docs.clear();
  }

  /** Note ids matching every word of `query`, best first. Empty query → nothing. */
  search(query: string, limit = 50): SearchHit[] {
    const words = unique(searchWords(query));
    if (words.length === 0) return [];
    const hits: (SearchHit & { u: number })[] = [];
    for (const [id, doc] of this.#docs) {
      let score = 0;
      let all = true;
      for (const q of words) {
        let best = 0;
        for (const w of doc.w) {
          if (w === q) {
            best = 2;
            break;
          }
          if (w.startsWith(q)) best = 1;
        }
        if (best === 0) {
          all = false;
          break;
        }
        score += best;
        if (doc.t.some((w) => w.startsWith(q))) score += 3;
      }
      if (all) hits.push({ id, score, u: doc.u });
    }
    hits.sort((a, b) => b.score - a.score || b.u - a.u || a.id.localeCompare(b.id));
    return hits.slice(0, limit).map(({ id, score }) => ({ id, score }));
  }

  /** The index encrypted for this device's storage. `name` keeps several indexes apart. */
  async seal(accountKey: AccountKey, name = 'notes'): Promise<Uint8Array> {
    const docs: Record<string, Doc> = {};
    for (const [id, d] of this.#docs) docs[id] = d;
    const key = await indexKey(accountKey);
    return encryptBytes(key, utf8(JSON.stringify({ v: 1, docs })), ad(name));
  }

  static async open(
    sealed: Uint8Array,
    accountKey: AccountKey,
    name = 'notes',
  ): Promise<NoteSearchIndex> {
    const key = await indexKey(accountKey);
    const raw = fromUtf8(await decryptBytes(key, sealed, ad(name)));
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new PoolseCryptoError('malformed', 'Search index is not JSON');
    }
    const p = parsed as { v?: number; docs?: Record<string, Doc> };
    if (p.v !== 1 || !p.docs || typeof p.docs !== 'object') {
      throw new PoolseCryptoError('unsupported', 'Unknown search index version');
    }
    const index = new NoteSearchIndex();
    for (const [id, d] of Object.entries(p.docs)) {
      if (Array.isArray(d.t) && Array.isArray(d.w)) {
        index.#docs.set(id, { t: d.t, w: d.w, u: typeof d.u === 'number' ? d.u : 0 });
      }
    }
    return index;
  }
}

function ad(name: string) {
  return { itemId: 'search-index', slot: name };
}

async function indexKey(accountKey: AccountKey): Promise<ItemKey> {
  const raw = await hkdf(
    secretOf(accountKey),
    new Uint8Array(0),
    label(DOMAIN, 'key/search-index'),
  );
  return ItemKey.fromBytes(raw, 1);
}

function unique(words: string[]): string[] {
  return [...new Set(words)];
}
