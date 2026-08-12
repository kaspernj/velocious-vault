import type {AsyncValueStore, AtomicKeyStore} from "./index.js"

export function createIndexedDbStore<T = unknown>(options: {
  databaseName?: string
  indexedDB?: IDBFactory
  storeName: string
}): AsyncValueStore<T> & {delete(key: string): Promise<boolean>, getOrCreate(key: string, value: T): Promise<T>}

export function createIndexedDbKeyStore(options?: {
  databaseName?: string
  indexedDB?: IDBFactory
  storeName?: string
}): AtomicKeyStore<CryptoKey> & {delete(key: string): Promise<boolean>}
