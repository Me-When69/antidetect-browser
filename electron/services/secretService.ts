export interface SafeStorageLike {
  isEncryptionAvailable: () => boolean;
  encryptString: (plainText: string) => Buffer;
  decryptString: (encrypted: Buffer) => string;
}

const ENC_PREFIX = 'enc:';
const PLAIN_PREFIX = 'b64:';

export class SecretService {
  private storage: SafeStorageLike | null;
  private legacyStorage: SafeStorageLike | null;

  constructor(
    storage: SafeStorageLike | null = null,
    legacyStorage: SafeStorageLike | null = null,
  ) {
    this.storage = storage;
    this.legacyStorage = legacyStorage;
  }

  encrypt(value: string): string {
    if (!value) {
      return '';
    }
    if (this.storage && this.storage.isEncryptionAvailable()) {
      const buf = this.storage.encryptString(value);
      return `${ENC_PREFIX}${buf.toString('base64')}`;
    }
    return `${PLAIN_PREFIX}${Buffer.from(value, 'utf8').toString('base64')}`;
  }

  decrypt(stored: string): string {
    if (!stored) {
      return '';
    }
    if (stored.startsWith(ENC_PREFIX)) {
      const b64 = stored.slice(ENC_PREFIX.length);
      const raw = Buffer.from(b64, 'base64');
      if (this.storage && this.storage.isEncryptionAvailable()) {
        try {
          return this.storage.decryptString(raw);
        } catch {
          // Fall through to legacyStorage fallback if provided (e.g. macOS Keychain / Linux libsecret rename)
        }
      }
      if (this.legacyStorage && this.legacyStorage.isEncryptionAvailable()) {
        try {
          return this.legacyStorage.decryptString(raw);
        } catch {
          return '';
        }
      }
      return '';
    }
    if (stored.startsWith(PLAIN_PREFIX)) {
      const b64 = stored.slice(PLAIN_PREFIX.length);
      return Buffer.from(b64, 'base64').toString('utf8');
    }
    return stored;
  }

  /**
   * If `stored` could only be decrypted via `legacyStorage`, re-encrypt it using the
   * current primary `storage` so future reads no longer depend on the legacy key.
   */
  reencryptIfLegacy(stored: string): string {
    if (!stored.startsWith(ENC_PREFIX) || !this.storage?.isEncryptionAvailable()) {
      return stored;
    }
    const raw = Buffer.from(stored.slice(ENC_PREFIX.length), 'base64');
    try {
      this.storage.decryptString(raw);
      return stored;
    } catch {
      if (this.legacyStorage?.isEncryptionAvailable()) {
        try {
          const plain = this.legacyStorage.decryptString(raw);
          return this.encrypt(plain);
        } catch {
          return stored;
        }
      }
      return stored;
    }
  }
}
