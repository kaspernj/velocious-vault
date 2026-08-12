import assert from "node:assert/strict"
import {webcrypto} from "node:crypto"
import test from "node:test"

import {
  VaultCapabilityError,
  VaultEnvelopeError,
  VaultPersistenceError,
  createEncryptedVault
} from "../src/index.js"

function memoryStore() {
  const records = new Map()
  return {
    delete: async (key) => records.delete(key),
    get: async (key) => records.get(key),
    getOrCreate: async (key, value) => {
      if (!records.has(key)) records.set(key, value)
      return records.get(key)
    },
    set: async (key, value) => records.set(key, value),
    records
  }
}

function coordinatedKeyStore() {
  const store = memoryStore()
  let waiting = 0
  let releaseReads
  const readsReleased = new Promise((resolve) => { releaseReads = resolve })
  return {
    ...store,
    get: async (key) => {
      const value = await store.get(key)
      if (value === undefined && ++waiting === 2) releaseReads()
      if (value === undefined) await readsReleased
      return value
    }
  }
}

test("encrypts, reads, overwrites, and deletes values", async () => {
  const keyStore = memoryStore()
  const recordStore = memoryStore()
  const vault = createEncryptedVault({keyStore, recordStore, subtle: webcrypto.subtle, getRandomValues: webcrypto.getRandomValues.bind(webcrypto)})

  await vault.set("instance:7:api-key", "sentinel-secret-one")
  assert.notEqual(JSON.stringify(recordStore.records.get("instance:7:api-key")), "sentinel-secret-one")
  assert.equal(await vault.get("instance:7:api-key"), "sentinel-secret-one")
  await vault.set("instance:7:api-key", "sentinel-secret-two")
  assert.equal(await vault.get("instance:7:api-key"), "sentinel-secret-two")
  assert.equal(await vault.delete("instance:7:api-key"), true)
  assert.equal(await vault.get("instance:7:api-key"), undefined)
})

test("persists a non-extractable AES-256-GCM CryptoKey", async () => {
  const keyStore = memoryStore()
  const vault = createEncryptedVault({keyStore, recordStore: memoryStore(), subtle: webcrypto.subtle, getRandomValues: webcrypto.getRandomValues.bind(webcrypto)})
  await vault.set("key", "value")

  const key = keyStore.records.get("velocious-vault:aes-gcm:1")
  assert.equal(key.algorithm.length, 256)
  assert.equal(key.extractable, false)
  await assert.rejects(webcrypto.subtle.exportKey("raw", key), /not extractable/i)
})

test("atomically creates one key across concurrent first writes from independent vaults", async () => {
  const keyStore = coordinatedKeyStore()
  const recordStore = memoryStore()
  const options = {keyStore, recordStore, subtle: webcrypto.subtle, getRandomValues: webcrypto.getRandomValues.bind(webcrypto)}
  const first = createEncryptedVault(options)
  const second = createEncryptedVault(options)

  await Promise.all([
    first.set("first", "sentinel-first"),
    second.set("second", "sentinel-second")
  ])

  const reloaded = createEncryptedVault(options)
  assert.equal(await reloaded.get("first"), "sentinel-first")
  assert.equal(await reloaded.get("second"), "sentinel-second")
})

test("binds ciphertext to its logical key with authenticated data", async () => {
  const recordStore = memoryStore()
  const vault = createEncryptedVault({keyStore: memoryStore(), recordStore, subtle: webcrypto.subtle, getRandomValues: webcrypto.getRandomValues.bind(webcrypto)})
  await vault.set("first", "sentinel-bound-secret")
  recordStore.records.set("second", recordStore.records.get("first"))

  await assert.rejects(vault.get("second"), VaultEnvelopeError)
})

test("rejects unsupported or malformed envelopes before decrypting", async () => {
  const recordStore = memoryStore()
  const vault = createEncryptedVault({keyStore: memoryStore(), recordStore, subtle: webcrypto.subtle, getRandomValues: webcrypto.getRandomValues.bind(webcrypto)})
  recordStore.records.set("key", {version: 2, algorithm: "AES-GCM", iv: "AA", ciphertext: "AA"})
  await assert.rejects(vault.get("key"), (error) => error instanceof VaultEnvelopeError && error.code === "INVALID_ENVELOPE")
})

test("fails with typed actionable errors when WebCrypto or key persistence is unavailable", async () => {
  assert.throws(() => createEncryptedVault({keyStore: memoryStore(), recordStore: memoryStore()}), (error) => error instanceof VaultCapabilityError && error.code === "WEBCRYPTO_UNAVAILABLE")

  const vault = createEncryptedVault({
    keyStore: {get: async () => undefined, getOrCreate: async () => { throw new Error("synthetic persistence failure") }, set: async () => {}},
    recordStore: memoryStore(),
    subtle: webcrypto.subtle,
    getRandomValues: webcrypto.getRandomValues.bind(webcrypto)
  })
  await assert.rejects(vault.set("key", "value"), (error) => error instanceof VaultPersistenceError && error.code === "KEY_PERSISTENCE_FAILED")
})

test("preserves typed key persistence failures while reading a valid envelope", async () => {
  const keyStore = memoryStore()
  const recordStore = memoryStore()
  const options = {keyStore, recordStore, subtle: webcrypto.subtle, getRandomValues: webcrypto.getRandomValues.bind(webcrypto)}
  await createEncryptedVault(options).set("key", "value")
  const failure = new VaultPersistenceError("synthetic key read failure", "INDEXEDDB_PERSISTENCE_FAILED")
  const reloaded = createEncryptedVault({...options, keyStore: {...keyStore, get: async () => { throw failure }}})

  await assert.rejects(reloaded.get("key"), (error) => error instanceof VaultPersistenceError && error.code === "KEY_PERSISTENCE_FAILED")
})
