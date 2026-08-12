import {VaultCapabilityError, VaultPersistenceError} from "./index.js"

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), {once: true})
    request.addEventListener("error", () => reject(request.error), {once: true})
  })
}

export function createIndexedDbStore({databaseName = "velocious-vault", indexedDB = globalThis.indexedDB, storeName}) {
  if (!indexedDB || typeof indexedDB.open !== "function") {
    throw new VaultCapabilityError("IndexedDB is unavailable. Persistent browser key storage is required.", "INDEXEDDB_UNAVAILABLE")
  }
  if (typeof storeName !== "string" || storeName.length === 0) throw new TypeError("storeName must be a non-empty string.")
  const databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1)
    request.addEventListener("upgradeneeded", () => {
      if (!request.result.objectStoreNames.contains(storeName)) request.result.createObjectStore(storeName)
    }, {once: true})
    request.addEventListener("success", () => resolve(request.result), {once: true})
    request.addEventListener("error", () => reject(request.error), {once: true})
    request.addEventListener("blocked", () => reject(new Error("IndexedDB upgrade blocked")), {once: true})
  })

  async function run(mode, operation) {
    try {
      const database = await databasePromise
      const transaction = database.transaction(storeName, mode)
      const result = await operation(transaction.objectStore(storeName))
      await new Promise((resolve, reject) => {
        transaction.addEventListener("complete", resolve, {once: true})
        transaction.addEventListener("abort", () => reject(transaction.error), {once: true})
        transaction.addEventListener("error", () => reject(transaction.error), {once: true})
      })
      return result
    } catch (cause) {
      throw new VaultPersistenceError("IndexedDB persistence failed. Check browser storage permissions and quota.", "INDEXEDDB_PERSISTENCE_FAILED", {cause})
    }
  }

  return Object.freeze({
    get: async (key) => await run("readonly", async (store) => await requestResult(store.get(key))),
    set: async (key, value) => await run("readwrite", async (store) => await requestResult(store.put(value, key))),
    delete: async (key) => await run("readwrite", async (store) => {
      const existed = await requestResult(store.getKey(key)) !== undefined
      await requestResult(store.delete(key))
      return existed
    })
  })
}

export function createIndexedDbKeyStore(options = {}) {
  return createIndexedDbStore({...options, storeName: options.storeName ?? "keys"})
}
