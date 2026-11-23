declare module 'fernet' {
  export class Secret {
    constructor(secretString: string);
  }
  export class Token {
    constructor(options: {
      secret: Secret;
      token?: string;
      ttl?: number;
      time?: number;
      iv?: number[];
    });
    encode(message?: string): string;
    decode(token?: string): string;
  }
}

declare module 'archiver-zip-encrypted' {
  const plugin: unknown;
  export default plugin;
}
