export interface AsyncValueStore<T> {
  get(key: string): Promise<T | undefined>
  set(key: string, value: T): Promise<unknown>
  delete?(key: string): Promise<boolean>
}

export interface EncryptedVault {
  get(logicalKey: string): Promise<string | undefined>
  set(logicalKey: string, value: string): Promise<void>
  delete(logicalKey: string): Promise<boolean>
}

export class VaultError extends Error { readonly code: string }
export class VaultCapabilityError extends VaultError {}
export class VaultPersistenceError extends VaultError {}
export class VaultEnvelopeError extends VaultError {}

export function createEncryptedVault(options: {
  keyStore: AsyncValueStore<CryptoKey>
  recordStore: AsyncValueStore<unknown>
  subtle: SubtleCrypto
  getRandomValues: <T extends ArrayBufferView | null>(array: T) => T
}): EncryptedVault
