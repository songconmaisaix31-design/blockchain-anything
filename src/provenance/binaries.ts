import { resolve as resolvePath } from 'node:path';
import { mkdir as mkdirAsync } from 'node:fs/promises';
import type { ProvenanceConfig } from './config.js';

export async function toolEnvironment(config: ProvenanceConfig, extra?: Record<string, string>): Promise<Record<string, string> | undefined> {
  if (!config.sigstoreHome) return extra;
  const home = resolvePath(config.workingRoot, config.sigstoreHome);
  await mkdirAsync(home, { recursive: true });
  return { ...extra, HOME: home, USERPROFILE: home, SIGSTORE_HOME: home };
}

export function binaryTimeout(config: ProvenanceConfig, requested?: number): number {
  return requested ?? Math.max(config.timeoutMs, 120_000);
}
