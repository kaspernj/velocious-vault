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
    set: async (key, value) => records.set(key, value),
    records
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
    keyStore: {get: async () => undefined, set: async () => { throw new Error("synthetic persistence failure") }},
    recordStore: memoryStore(),
    subtle: webcrypto.subtle,
    getRandomValues: webcrypto.getRandomValues.bind(webcrypto)
  })
  await assert.rejects(vault.set("key", "value"), (error) => error instanceof VaultPersistenceError && error.code === "KEY_PERSISTENCE_FAILED")
})
