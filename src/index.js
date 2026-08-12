const KEY_ID = "velocious-vault:aes-gcm:1"
const VERSION = 1
const ALGORITHM = "AES-GCM"
const encoder = new TextEncoder()
const decoder = new TextDecoder("utf-8", {fatal: true})

export class VaultError extends Error {
  constructor(message, code, options) {
    super(message, options)
    this.name = this.constructor.name
    this.code = code
  }
}

export class VaultCapabilityError extends VaultError {}
export class VaultPersistenceError extends VaultError {}
export class VaultEnvelopeError extends VaultError {}

function assertAdapter(adapter, name) {
  if (!adapter || typeof adapter.get !== "function" || typeof adapter.set !== "function") {
    throw new TypeError(`${name} must provide async get() and set() methods.`)
  }
}

function encodeBase64(bytes) {
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function decodeBase64(value) {
  if (typeof value !== "string" || value.length === 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new VaultEnvelopeError("The encrypted record envelope is invalid.", "INVALID_ENVELOPE")
  }
  const binary = atob(value)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function validateEnvelope(envelope) {
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope) || envelope.version !== VERSION || envelope.algorithm !== ALGORITHM) {
    throw new VaultEnvelopeError("The encrypted record envelope is invalid or unsupported.", "INVALID_ENVELOPE")
  }
  const iv = decodeBase64(envelope.iv)
  const ciphertext = decodeBase64(envelope.ciphertext)
  if (iv.byteLength !== 12 || ciphertext.byteLength < 17) {
    throw new VaultEnvelopeError("The encrypted record envelope is invalid.", "INVALID_ENVELOPE")
  }
  return {iv, ciphertext}
}

function persistenceError(message, code, cause) {
  return new VaultPersistenceError(message, code, {cause})
}

export function createEncryptedVault({keyStore, recordStore, subtle, getRandomValues} = {}) {
  assertAdapter(keyStore, "keyStore")
  assertAdapter(recordStore, "recordStore")
  if (!subtle || typeof subtle.generateKey !== "function" || typeof subtle.encrypt !== "function" || typeof getRandomValues !== "function") {
    throw new VaultCapabilityError("WebCrypto AES-GCM is unavailable. Use this vault in a secure browser context with WebCrypto enabled.", "WEBCRYPTO_UNAVAILABLE")
  }

  let keyPromise
  async function loadKey() {
    if (keyPromise) return await keyPromise
    keyPromise = (async () => {
      let key
      try {
        key = await keyStore.get(KEY_ID)
      } catch (cause) {
        throw persistenceError("The encryption key could not be read from persistent storage.", "KEY_PERSISTENCE_FAILED", cause)
      }
      if (key !== undefined) return key
      const created = await subtle.generateKey({name: ALGORITHM, length: 256}, false, ["encrypt", "decrypt"])
      try {
        await keyStore.set(KEY_ID, created)
        const persisted = await keyStore.get(KEY_ID)
        if (!persisted) throw new Error("Encryption key readback failed")
        return persisted
      } catch (cause) {
        throw persistenceError("The encryption key could not be persisted. Check browser storage permissions and availability.", "KEY_PERSISTENCE_FAILED", cause)
      }
    })()
    try {
      return await keyPromise
    } catch (error) {
      keyPromise = undefined
      throw error
    }
  }

  return Object.freeze({
    async get(logicalKey) {
      let envelope
      try {
        envelope = await recordStore.get(logicalKey)
      } catch (cause) {
        throw persistenceError("The encrypted record could not be read.", "RECORD_PERSISTENCE_FAILED", cause)
      }
      if (envelope === undefined) return undefined
      const {iv, ciphertext} = validateEnvelope(envelope)
      try {
        const plaintext = await subtle.decrypt({name: ALGORITHM, iv, additionalData: encoder.encode(logicalKey), tagLength: 128}, await loadKey(), ciphertext)
        return decoder.decode(plaintext)
      } catch (cause) {
        throw new VaultEnvelopeError("The encrypted record could not be authenticated or decrypted.", "DECRYPTION_FAILED", {cause})
      }
    },

    async set(logicalKey, value) {
      if (typeof logicalKey !== "string" || logicalKey.length === 0) throw new TypeError("logicalKey must be a non-empty string.")
      if (typeof value !== "string") throw new TypeError("value must be a string.")
      const iv = new Uint8Array(12)
      getRandomValues(iv)
      const ciphertext = await subtle.encrypt({name: ALGORITHM, iv, additionalData: encoder.encode(logicalKey), tagLength: 128}, await loadKey(), encoder.encode(value))
      const envelope = {version: VERSION, algorithm: ALGORITHM, iv: encodeBase64(iv), ciphertext: encodeBase64(new Uint8Array(ciphertext))}
      try {
        await recordStore.set(logicalKey, envelope)
      } catch (cause) {
        throw persistenceError("The encrypted record could not be persisted.", "RECORD_PERSISTENCE_FAILED", cause)
      }
    },

    async delete(logicalKey) {
      if (typeof recordStore.delete !== "function") throw new TypeError("recordStore must provide async delete() to remove values.")
      try {
        return await recordStore.delete(logicalKey)
      } catch (cause) {
        throw persistenceError("The encrypted record could not be deleted.", "RECORD_PERSISTENCE_FAILED", cause)
      }
    }
  })
}
