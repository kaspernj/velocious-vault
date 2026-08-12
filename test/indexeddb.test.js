import assert from "node:assert/strict"
import {webcrypto} from "node:crypto"
import test from "node:test"
import {IDBFactory} from "fake-indexeddb"

import {createEncryptedVault, VaultCapabilityError} from "../src/index.js"
import {createIndexedDbKeyStore, createIndexedDbStore} from "../src/indexeddb.js"

test("persists a non-extractable key and encrypted records across vault instances", async () => {
  const indexedDB = new IDBFactory()
  const keyStore = createIndexedDbKeyStore({databaseName: "browser-test-keys", indexedDB})
  const recordStore = createIndexedDbStore({databaseName: "browser-test-records", indexedDB, storeName: "records"})
  const options = {keyStore, recordStore, subtle: webcrypto.subtle, getRandomValues: webcrypto.getRandomValues.bind(webcrypto)}
  await createEncryptedVault(options).set("instance:9:native-password", "sentinel-browser-secret")

  assert.equal(await createEncryptedVault(options).get("instance:9:native-password"), "sentinel-browser-secret")
  assert.equal((await keyStore.get("velocious-vault:aes-gcm:1")).extractable, false)
})

test("creates distinct requested stores in the same database", async () => {
  const indexedDB = new IDBFactory()
  const databaseName = "shared-browser-test"
  const keyStore = createIndexedDbKeyStore({databaseName, indexedDB, storeName: "keys"})
  const recordStore = createIndexedDbStore({databaseName, indexedDB, storeName: "records"})

  await keyStore.set("key", "key-value")
  await recordStore.set("record", "record-value")

  assert.equal(await keyStore.get("key"), "key-value")
  assert.equal(await recordStore.get("record"), "record-value")
})

test("fails actionably instead of using a fallback when IndexedDB is unavailable", () => {
  assert.throws(() => createIndexedDbKeyStore({indexedDB: undefined}), (error) => error instanceof VaultCapabilityError && error.code === "INDEXEDDB_UNAVAILABLE")
})
