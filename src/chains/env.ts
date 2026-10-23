/**
 * 链与存储适配器共用的进程配置读取。
 *
 * 该模块只读取操作者显式提供的环境变量。没有隐式主网/测试网默认值；
 * 缺少必需值、值格式错误或 URL 不是 HTTP(S) 时立即抛出异常。
 * 这里不保存或输出 URL、私钥、API Key 等秘密。
 */

export function optionalEnv(name: string): string | undefined {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') return undefined;
  return value.trim();
}

export function requiredEnv(name: string): string {
  const value = optionalEnv(name);
  if (!value) throw new Error(`需要 ${name}`);
  return value;
}

export function httpUrl(name: string, required: true): string;
export function httpUrl(name: string, required?: false): string | undefined;
export function httpUrl(name: string, required = false): string | undefined {
  const value = required ? requiredEnv(name) : optionalEnv(name);
  if (value === undefined) return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} 必须为 HTTP(S) URL`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`${name} 必须为 HTTP(S) URL`);
  }
  return value;
}

export function positiveInteger(name: string, fallback: number): number {
  const value = optionalEnv(name);
  if (value === undefined) return fallback;
  if (!/^[1-9][0-9]*$/.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new Error(`${name} 必须为正的安全整数`);
  }
  return Number(value);
}

export function timeoutMs(): number {
  return positiveInteger('BCA_TIMEOUT_MS', 30_000);
}

export function maxReadBytes(fallback = 1024 * 1024): number {
  return positiveInteger('BCA_MAX_READ_BYTES', fallback);
}

export function csv(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

export function jsonArray(name: string, required = true): unknown[] {
  const value = required ? requiredEnv(name) : optionalEnv(name);
  if (value === undefined) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`${name} 必须为 JSON 数组`);
  }
  if (!Array.isArray(parsed)) throw new Error(`${name} 必须为 JSON 数组`);
  return parsed;
}

export function oneOf<T extends string>(name: string, allowed: readonly T[], fallback?: T): T {
  const value = optionalEnv(name) ?? fallback;
  if (value === undefined) throw new Error(`需要 ${name}（可选值：${allowed.join('、')}）`);
  if (!(allowed as readonly string[]).includes(value)) {
    throw new Error(`${name} 必须为 ${allowed.join('、')} 之一`);
  }
  return value as T;
}

/** 用于在错误信息中替换配置的服务端点，避免把带凭证的 URL 写入结果。 */
export function redactEndpoints(message: string, endpoints: Array<string | undefined>): string {
  let result = message;
  for (const endpoint of endpoints) {
    if (!endpoint) continue;
    result = result.split(endpoint).join('[ENDPOINT]');
    try {
      const url = new URL(endpoint);
      for (const secret of [url.username, url.password].filter(Boolean)) {
        result = result.split(secret).join('[REDACTED]');
        result = result.split(decodeURIComponent(secret)).join('[REDACTED]');
      }
      url.searchParams.forEach((value, key) => {
        if (!value) return;
        result = result.split(value).join('[REDACTED]');
        result = result.split(`${key}=${value}`).join('[REDACTED]');
      });
    } catch {
      // 非 URL 的配置值不需要解析。
    }
  }
  return result.replace(/https?:\/\/[^\s"'<>]+/g, '[ENDPOINT]');
}

export function sanitizeError(error: unknown, endpoints: Array<string | undefined>): Error {
  const message = error instanceof Error ? error.message : '操作失败';
  return new Error(redactEndpoints(message, endpoints));
}

export async function withTimeout<T>(operation: Promise<T>, label: string): Promise<T> {
  try {
    return await operation;
  } catch (error) {
    if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
      throw new Error(`${label} 超时`);
    }
    throw error;
  }
}

/** 统一把 bigint/Uint8Array 转成可 JSON 序列化的值，保留十进制字符串和 base64。 */
export function jsonSafe(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, (_key, item: unknown) => {
    if (typeof item === 'bigint') return item.toString();
    if (item instanceof Uint8Array) return Buffer.from(item).toString('base64');
    return item;
  }));
}
