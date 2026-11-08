export interface StoredProject {
  version: number
  savedAt: number
  scene: unknown
}

const DB_NAME = 'grid-massing-studio'
const DB_VERSION = 1
const STORE = 'projects'
const CURRENT_KEY = 'current'

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'))
      return
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'))
  })
  return dbPromise
}

export async function saveStoredProject(project: StoredProject): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readwrite')
    transaction.objectStore(STORE).put(project, CURRENT_KEY)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB save failed'))
  })
}

export async function loadStoredProject(): Promise<StoredProject | null> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readonly')
    const request = transaction.objectStore(STORE).get(CURRENT_KEY)
    request.onsuccess = () => {
      const value = request.result as StoredProject | undefined
      resolve(value && typeof value === 'object' ? value : null)
    }
    request.onerror = () => reject(request.error ?? new Error('IndexedDB load failed'))
  })
}

export async function clearStoredProject(): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readwrite')
    transaction.objectStore(STORE).delete(CURRENT_KEY)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB clear failed'))
  })
}
