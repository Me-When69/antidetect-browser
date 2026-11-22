export interface SafeStorageLike {
  isEncryptionAvailable: () => boolean;
  encryptString: (plainText: string) => Buffer;
  decryptString: (encrypted: Buffer) => string;
}

const ENC_PREFIX = 'enc:';
const PLAIN_PREFIX = 'b64:';

export class SecretService {
  private storage: SafeStorageLike | null;

  constructor(storage: SafeStorageLike | null = null) {
    this.storage = storage;
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
      if (this.storage && this.storage.isEncryptionAvailable()) {
        try {
          return this.storage.decryptString(Buffer.from(b64, 'base64'));
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
}
