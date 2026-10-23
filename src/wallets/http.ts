import type { WalletConfig } from './config.js';
import { redactSecrets } from './config.js';

function errorDetails(value: unknown): string {
  if (typeof value !== 'object' || value === null) return '';
  const record = value as Record<string, unknown>;
  for (const key of ['invalidReason', 'error', 'message', 'detail']) {
    if (typeof record[key] === 'string' && record[key]) return `：${record[key]}`;
  }
  return '';
}

export async function requestJson<T>(
  url: string,
  init: RequestInit,
  config: WalletConfig,
  label: string,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      redirect: 'error',
      signal: AbortSignal.timeout(config.base.timeoutMs),
      headers: { accept: 'application/json', ...init.headers },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '网络请求失败';
    throw new Error(redactSecrets(`${label} 请求失败：${message}`, config));
  }
  const text = await response.text();
  let body: unknown;
  try { body = text ? JSON.parse(text) : undefined; } catch {
    throw new Error(redactSecrets(`${label} HTTP ${response.status} 返回非 JSON 内容`, config));
  }
  if (!response.ok) {
    throw new Error(redactSecrets(`${label} HTTP ${response.status}${errorDetails(body)}`, config));
  }
  return body as T;
}
