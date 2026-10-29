import assert from 'node:assert/strict';
import { readConfig } from '../src/config.js';
import { goplusTools, type GoPlusTokenSecurityResult } from '../src/providers/goplus.js';

const tool = goplusTools(readConfig())[0]!;
// 两个地址均来自 Circle 官方 USDC 合约地址目录。
const inputs = [
  { chainId: '1', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' },
  { chainId: '8453', address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' },
];
for (const input of inputs) {
  const result = await tool.execute(input) as GoPlusTokenSecurityResult;
  assert.equal(result.response.code, 1);
  assert.equal(result.chainId, input.chainId);
  assert.equal(result.address, input.address.toLowerCase());
  const risk = result.response.result[result.address];
  assert.ok(risk, '真实响应必须包含所请求的合约');
  assert.equal(risk.token_symbol, 'USDC');
  assert.ok(['0', '1'].includes(String(risk.is_open_source)), '真实响应必须包含开源状态');
  assert.equal(new URL(result.source).hostname, 'api.gopluslabs.io');
  assert.ok(Number.isFinite(Date.parse(result.queriedAt)));
  console.log(JSON.stringify({ chainId: result.chainId, address: result.address, queriedAt: result.queriedAt,
    token_symbol: risk.token_symbol, is_open_source: risk.is_open_source, is_proxy: risk.is_proxy, is_honeypot: risk.is_honeypot }));
}
await assert.rejects(tool.execute({ chainId: '31337', address: inputs[0]!.address }), (error: unknown) => {
  assert.ok(error instanceof Error);
  assert.match(error.message, /GoPlus 请求失败（code=2022）/);
  console.log(`官方不支持链的实际错误：${error.message}`);
  return true;
});
await assert.rejects(tool.execute({ chainId: '1', address: '0x0000000000000000000000000000000000000000' }), (error: unknown) => {
  assert.ok(error instanceof Error);
  assert.match(error.message, /GoPlus (?:未返回|响应缺少)/);
  console.log(`无代币数据的实际错误：${error.message}`);
  return true;
});
