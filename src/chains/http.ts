import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

/**
 * 强制 IPv4 的 fetch 替代实现，仅用于本地/受限环境（BCA_IPV4_ONLY=true）。
 * 默认不启用；正常环境继续使用全局 fetch。
 */
export function ipv4Fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url);
  const method = init?.method ?? 'GET';
  const headers = Object.fromEntries(new Headers(init?.headers).entries());
  const body = typeof init?.body === 'string' ? Buffer.from(init.body) : undefined;
  return new Promise((resolve, reject) => {
    const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)({
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: `${url.pathname}${url.search}`,
      method,
      headers,
      family: 4,
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => {
        resolve(new Response(Buffer.concat(chunks), {
          status: response.statusCode ?? 0,
          statusText: response.statusMessage ?? '',
          headers: response.headers as Record<string, string>,
        }));
      });
      response.on('error', reject);
    });
    request.on('error', reject);
    if (body) request.write(body);
    request.end();
  });
}

export function rpcFetchForEnvironment(): typeof fetch | undefined {
  return process.env.BCA_IPV4_ONLY === 'true' ? ipv4Fetch as typeof fetch : undefined;
}
