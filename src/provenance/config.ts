import type { Config } from '../config.js';

export interface ProvenanceConfig {
  workingRoot: string;
  maxFileBytes: number;
  timeoutMs: number;
  cosignPath: string;
  c2patoolPath: string;
  slsaVerifierPath: string;
  inTotoSignPath: string;
  pythonPath: string;
  sigstoreHome?: string;
  risc0Verifier?: string;
  cheqdResolverUrl: string;
}

function command(value: string | undefined, fallback: string): string {
  return value || fallback;
}

export function readProvenanceConfig(config: Config): ProvenanceConfig {
  const env = process.env;
  return {
    workingRoot: config.workingRoot,
    maxFileBytes: config.maxFileBytes,
    timeoutMs: config.timeoutMs,
    cosignPath: command(env.BCA_COSIGN_PATH, 'cosign'),
    c2patoolPath: command(env.BCA_C2PATOOL_PATH, 'c2patool'),
    slsaVerifierPath: command(env.BCA_SLSA_VERIFIER_PATH, 'slsa-verifier'),
    inTotoSignPath: command(env.BCA_IN_TOTO_SIGN_PATH, 'in-toto-sign'),
    pythonPath: command(env.BCA_PYTHON_PATH, 'python'),
    sigstoreHome: env.BCA_SIGSTORE_HOME || undefined,
    risc0Verifier: env.BCA_RISC0_VERIFIER || undefined,
    cheqdResolverUrl: (env.BCA_CHEQD_RESOLVER_URL || 'https://resolver.cheqd.net/1.0/identifiers').replace(/\/+$/, ''),
  };
}

export function requireEndpoint(value: string, name: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error(`${name} 必须为 HTTP(S) URL`); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error(`${name} 必须为 HTTP(S) URL`);
  return value.replace(/\/+$/, '');
}
