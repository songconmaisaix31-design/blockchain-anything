declare module 'opentimestamps' {
  export interface TimestampNode {
    msg: Uint8Array;
    attestations: any[];
    ops: Map<any, TimestampNode>;
  }

  export interface DetachedTimestampFile {
    fileHashOp: any;
    timestamp: TimestampNode;
    serializeToBytes(): Uint8Array;
  }

  export const DetachedTimestampFile: {
    deserialize(bytes: Uint8Array): DetachedTimestampFile;
    fromBytes(op: any, bytes: Uint8Array): DetachedTimestampFile;
    fromHash(op: any, hash: Uint8Array): DetachedTimestampFile;
  };

  export const Ops: { OpSHA256: new () => any };
  export const Notary: {
    BitcoinBlockHeaderAttestation: new (...args: any[]) => { height: number };
    LitecoinBlockHeaderAttestation: new (...args: any[]) => { height: number };
    PendingAttestation: new (...args: any[]) => { uri: string };
    UnknownAttestation: new (...args: any[]) => any;
  };
  export function info(detached: DetachedTimestampFile): string;
  export function verify(
    detached: DetachedTimestampFile,
    target: DetachedTimestampFile,
    options?: { ignoreBitcoinNode?: boolean; timeout?: number },
  ): Promise<Record<string, { timestamp: number; height: number }> | undefined>;
}

declare module '@digitalbazaar/vc' {
  export interface DocumentLoaderResult {
    contextUrl: string | null;
    documentUrl: string;
    document: unknown;
  }
  export function issue(options: any): Promise<any>;
  export function verifyCredential(options: any): Promise<any>;
  export function defaultDocumentLoader(url: string): Promise<DocumentLoaderResult>;
}

declare module '@digitalbazaar/data-integrity' {
  export class DataIntegrityProof {
    constructor(options: any);
  }
}

declare module '@digitalbazaar/eddsa-rdfc-2022-cryptosuite' {
  export const cryptosuite: any;
}

declare module '@digitalbazaar/ed25519-multikey' {
  export function generate(options?: any): Promise<any>;
  export function from(options: any): Promise<any>;
}

declare module '@digitalbazaar/credentials-context' {
  export const contexts: Map<string, any>;
  export const named: Map<string, any>;
}

declare module '@digitalbazaar/data-integrity-context' {
  export const contexts: Map<string, any>;
  export const CONTEXT_URL: string;
  export const DATA_INTEGRITY_CONTEXT_V2_URL: string;
}

declare module '@digitalbazaar/multikey-context' {
  export const contexts: Map<string, any>;
  export const CONTEXT_URL: string;
}

declare module '@digitalbazaar/security-context' {
  export const contexts: Map<string, any>;
}
