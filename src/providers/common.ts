import { z } from 'zod';
import { isAddress } from 'ethers';
import type { Config } from '../config.js';

export const addressSchema = z.string().refine(isAddress, '必须为 EVM 地址');
export const uidSchema = z.string().regex(/^0x[0-9a-fA-F]{64}$/, '必须为 bytes32');
export const bytesSchema = z.string().regex(/^0x(?:[0-9a-fA-F]{2})*$/, '必须为十六进制字节');
export const uint64Schema = z.string().regex(/^(0|[1-9][0-9]*)$/).refine((s) => BigInt(s) < 2n ** 64n, '超出 uint64');
export const uint256Schema = z.string().regex(/^(0|[1-9][0-9]*)$/).refine((s) => BigInt(s) < 2n ** 256n, '超出 uint256');
export const submitSchema = z.literal(true).describe('明确同意本次写入或签署');

export function serializable(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, (_key, item: unknown) => typeof item === 'bigint' ? item.toString() : item));
}

export class TransactionFailure extends Error {
  constructor(message: string, public readonly transactionHash: string) {
    super(`${message}；transactionHash=${transactionHash}；请查询回执后再决定后续操作`);
    this.name = 'TransactionFailure';
  }
}

export function safeError(error: unknown, config: Config): Error {
  const original = error instanceof Error ? error.message : '操作失败';
  let message = original;
  const secrets = [config.privateKey, config.rpcUrl, config.ipfsUrl].filter((v): v is string => Boolean(v));
  for (const [name, value] of Object.entries(process.env)) {
    if (value && value.length >= 4 && /(?:KEY|TOKEN|SECRET|PASSWORD|AUTH|CREDENTIAL)/i.test(name)) secrets.push(value);
  }
  for (const endpoint of [config.rpcUrl, config.ipfsUrl]) {
    if (!endpoint) continue;
    const url = new URL(endpoint);
    secrets.push(url.username, url.password, decodeURIComponent(url.username), decodeURIComponent(url.password));
    url.searchParams.forEach((value) => secrets.push(value));
    for (const part of url.pathname.split('/')) if (part) secrets.push(part);
    if (url.username || url.password) secrets.push(Buffer.from(`${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`).toString('base64'));
  }
  for (const secret of secrets.filter(Boolean).sort((a, b) => b.length - a.length)) message = message.split(secret).join('[REDACTED]');
  message = message.replace(/https?:\/\/[^\s"'<>]+/g, '[ENDPOINT]');
  const sanitized = new Error(message);
  if (error instanceof TransactionFailure) {
    sanitized.name = error.name;
    Object.assign(sanitized, { transactionHash: error.transactionHash });
  }
  return sanitized;
}
