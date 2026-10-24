import type { Config } from '../config.js';

/** Operator-selected endpoints only; tool arguments never select a host. */
export function endpointEnv(name: string, fallback?: string): string {
  const value = process.env[name] || fallback;
  if (!value) throw new Error(`需要 ${name}`);
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error(`${name} 必须为无内嵌凭据的 HTTP(S) URL`);
  return value.replace(/\/$/, '');
}

export async function requestBytes(config: Config, url: string, init: RequestInit = {}): Promise<{ bytes: Buffer; headers: Headers }> {
  const response = await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(config.timeoutMs) });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`上游请求失败：HTTP ${response.status}`);
  }
  const chunks: Buffer[] = [];
  let size = 0;
  const reader = response.body?.getReader();
  try {
    if (reader) while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > config.maxReadBytes) throw new Error('上游响应超过 BCA_MAX_READ_BYTES');
      chunks.push(Buffer.from(value));
    }
  } finally { await reader?.cancel(); }
  return { bytes: Buffer.concat(chunks), headers: response.headers };
}

export async function requestJson(config: Config, url: string, init?: RequestInit): Promise<unknown> {
  return JSON.parse((await requestBytes(config, url, init)).bytes.toString('utf8'));
}

export function envHeaders(name: string, header = 'Authorization', prefix = 'Bearer '): Record<string, string> {
  const value = process.env[name];
  if (!value) throw new Error(`需要 ${name}`);
  if (/[\r\n\0]/.test(value)) throw new Error(`${name} 包含非法字符`);
  return { [header]: `${prefix}${value}` };
}
