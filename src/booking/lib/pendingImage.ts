"use client";

/* ── Holding the reference image before there is anyone to attach it to ──
 * The visitor picks their artwork on the STORY step, which comes before
 * they hand over a phone number. Two things follow from that:
 *
 *   · uploading straight away means accepting files from anyone who loads
 *     the page — free, anonymous file hosting on the studio's domain
 *   · but losing the file when the tab is discarded means asking a customer
 *     to find and pick their photo a second time
 *
 * So it is held here until a lead exists, then uploaded and replaced by its
 * URL. IndexedDB, not localStorage: localStorage stores strings only and
 * caps around 5 MB, while the images allowed here go to 10 MB.
 * ────────────────────────────────────────────────────────────────── */

const DB_NAME = "cleo-booking";
const STORE = "pending-image";
const DB_VERSION = 1;
/** A draft older than this is not being finished. */
const TTL_MS = 24 * 60 * 60 * 1000;

interface StoredImage {
  blob: Blob;
  name: string;
  type: string;
  at: number;
}

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null);
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      // Private mode, or storage disabled entirely.
      return resolve(null);
    }
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest,
): Promise<T | null> {
  const db = await open();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, mode);
      const request = fn(tx.objectStore(STORE));
      request.onsuccess = () => resolve(request.result as T);
      request.onerror = () => resolve(null);
      tx.oncomplete = () => db.close();
    } catch {
      db.close();
      resolve(null);
    }
  });
}

/** Keeps the picked file across a reload while the visitor is anonymous. */
export async function savePendingImage(key: string, file: File): Promise<void> {
  const record: StoredImage = { blob: file, name: file.name, type: file.type, at: Date.now() };
  await withStore("readwrite", (store) => store.put(record, key));
}

export async function readPendingImage(key: string): Promise<File | null> {
  const record = await withStore<StoredImage>("readonly", (store) => store.get(key));
  if (!record?.blob) return null;
  if (Date.now() - record.at > TTL_MS) {
    void clearPendingImage(key);
    return null;
  }
  try {
    return new File([record.blob], record.name || "reference", { type: record.type || record.blob.type });
  } catch {
    return null;
  }
}

export async function clearPendingImage(key: string): Promise<void> {
  await withStore("readwrite", (store) => store.delete(key));
}

/** A preview the <img> can render without a round trip to the server. */
export function previewUrl(file: File): string {
  return URL.createObjectURL(file);
}
