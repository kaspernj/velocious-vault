import type {AsyncValueStore} from "./index.js"

export function createIndexedDbStore<T = unknown>(options: {
  databaseName?: string
  indexedDB?: IDBFactory
  storeName: string
}): AsyncValueStore<T> & {delete(key: string): Promise<boolean>}

export function createIndexedDbKeyStore(options?: {
  databaseName?: string
  indexedDB?: IDBFactory
  storeName?: string
}): AsyncValueStore<CryptoKey> & {delete(key: string): Promise<boolean>}
