# velocious-vault

Framework-neutral encrypted secret-value storage for browsers. It encrypts strings with WebCrypto AES-256-GCM and delegates persistence to small async key/value adapters. It has no dependency on a UI framework, database, backend, or Velocious.

## Install

```sh
npm install velocious-vault
```

The package is ESM-only and requires WebCrypto plus persistent structured-clone storage for its non-extractable `CryptoKey`.

## API

```js
import {createEncryptedVault} from "velocious-vault"
import {createIndexedDbKeyStore} from "velocious-vault/indexeddb"

const keyStore = createIndexedDbKeyStore()
const recordStore = {
  get: async (logicalKey) => loadEncryptedRecord(logicalKey),
  set: async (logicalKey, envelope) => saveEncryptedRecord(logicalKey, envelope),
  delete: async (logicalKey) => deleteEncryptedRecord(logicalKey)
}

const vault = createEncryptedVault({
  keyStore,
  recordStore,
  subtle: globalThis.crypto.subtle,
  getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto)
})

await vault.set("instance:42:api-key", "secret value")
await vault.get("instance:42:api-key")
await vault.delete("instance:42:api-key")
```

Both adapters use async `get(key)`, `set(key, value)`, and (for encrypted records) `delete(key)`. Key-store adapters additionally provide atomic `getOrCreate(key, value)` so concurrent vault instances cannot replace one another's encryption key. Missing values return `undefined`. The package deliberately has no enumeration or export API.

`createIndexedDbKeyStore()` stores a generated non-extractable `CryptoKey` in IndexedDB. It never exports raw key material. Applications own encrypted-record persistence and lifecycle; record values are versioned JSON-compatible envelopes. Each ciphertext is authenticated against its logical key as AES-GCM additional authenticated data, so moving a record to another key makes decryption fail.

Errors extend `VaultError` and expose stable `code` values. `VaultCapabilityError` reports missing WebCrypto or IndexedDB. `VaultPersistenceError` reports key/record persistence failures. `VaultEnvelopeError` reports invalid, unsupported, unauthenticated, or undecryptable envelopes. These failures are intentional and actionable: the package never falls back to plaintext or memory-only storage.

## Threat model

This protects persisted secret values from casual inspection, database exports, and disclosure of the encrypted-record store alone. AES-GCM provides confidentiality and integrity, and logical-key binding prevents ciphertext substitution between records. The non-extractable key is stored separately in IndexedDB through the browser structured-clone mechanism.

It does not protect against JavaScript executing in the application origin, a compromised browser/profile/device, malicious extensions with page access, runtime memory inspection, or an attacker who obtains both the browser key store and encrypted records. Non-extractable means WebCrypto will not export raw key bytes; authorized origin code can still ask WebCrypto to decrypt. Applications remain responsible for access control, CSP/dependency hygiene, deletion, backups, and preventing plaintext secrets from logs, exports, URLs, analytics, and UI diagnostics.

Persistent browser storage can be denied, cleared, blocked, or quota-limited. Such conditions raise typed errors and require user remediation or secret re-entry. Losing the key makes existing ciphertext unrecoverable.

## Development

Use Node 24:

```sh
npm test
npm run lint
```

Node tests inject `node:crypto` WebCrypto and in-memory adapters. IndexedDB behavior is covered with a browser-compatible IndexedDB implementation.
