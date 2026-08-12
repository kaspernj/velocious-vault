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
  let databasePromise

  function open(version, onVersionChange) {
    return new Promise((resolve, reject) => {
      const request = version === undefined ? indexedDB.open(databaseName) : indexedDB.open(databaseName, version)
      let settled = false
      request.addEventListener("upgradeneeded", () => {
        if (!request.result.objectStoreNames.contains(storeName)) request.result.createObjectStore(storeName)
      }, {once: true})
      request.addEventListener("success", () => {
        if (settled) {
          request.result.close()
          return
        }
        settled = true
        const database = request.result
        database.addEventListener("versionchange", () => {
          database.close()
          onVersionChange()
        })
        resolve(database)
      }, {once: true})
      request.addEventListener("error", () => {
        if (!settled) {
          settled = true
          reject(request.error)
        }
      }, {once: true})
      request.addEventListener("blocked", () => {
        if (!settled) {
          settled = true
          reject(new Error("IndexedDB schema upgrade is blocked by another open connection."))
        }
      }, {once: true})
    })
  }

  async function ensureStore(onVersionChange) {
    let version
    while (true) {
      let database
      try {
        database = await open(version, onVersionChange)
      } catch (error) {
        if (error?.name === "VersionError") {
          version = undefined
          continue
        }
        throw error
      }
      if (database.objectStoreNames.contains(storeName)) return database
      version = database.version + 1
      database.close()
    }
  }

  function getDatabase() {
    if (databasePromise) return databasePromise
    let pending
    pending = ensureStore(() => {
      if (databasePromise === pending) databasePromise = undefined
    })
    databasePromise = pending
    return pending
  }

  async function run(mode, operation) {
    try {
      const database = await getDatabase()
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
    getOrCreate: async (key, value) => await run("readwrite", async (store) => {
      const existing = await requestResult(store.get(key))
      if (existing !== undefined) return existing
      await requestResult(store.put(value, key))
      return value
    }),
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
