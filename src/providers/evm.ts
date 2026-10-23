import { FetchRequest, JsonRpcProvider, getAddress, verifyMessage } from 'ethers';
import { z } from 'zod';
import type { Config } from '../config.js';
import { configurationStatus } from '../config.js';
import { defineTool } from '../types.js';
import { addressSchema, uidSchema } from './common.js';

export async function withProvider<T>(config: Config, operation: (provider: JsonRpcProvider) => Promise<T>): Promise<T> {
  if (!config.rpcUrl || !config.chainId) throw new Error('需要 BCA_RPC_URL 和 BCA_CHAIN_ID');
  const request = new FetchRequest(config.rpcUrl);
  request.timeout = config.timeoutMs;
  request.setThrottleParams({ maxAttempts: 1 });
  request.retryFunc = async () => false;
  // 显式查询实际 chain ID，避免 ethers 后台网络发现向 MCP stdout 写入诊断。
  const provider = new JsonRpcProvider(request, config.chainId, { staticNetwork: true, batchMaxCount: 1, cacheTimeout: -1 });
  try {
    const actual = BigInt(await provider.send('eth_chainId', []));
    if (actual !== config.chainId) throw new Error(`chain ID 不匹配：预期 ${config.chainId}，实际 ${actual}`);
    return await operation(provider);
  } finally {
    provider.destroy();
  }
}

export function evmTools(config: Config) {
  return [
    defineTool('evm_status', '读取各适配器的进程配置状态；不连接网络，不返回 RPC URL 或秘密。', z.strictObject({}), true,
      async () => configurationStatus(config)),
    defineTool('evm_chain', '连接配置的 EVM，核对 chain ID 并读取最新区块。', z.strictObject({}), true,
      async () => withProvider(config, async (provider) => {
        const block = await provider.getBlock('latest');
        if (!block) throw new Error('最新区块不存在');
        return { chainId: config.chainId, connectionVerified: true, block: { number: block.number, hash: block.hash, parentHash: block.parentHash, timestamp: block.timestamp } };
      })),
    defineTool('evm_balance', '查询 EVM 地址的原生币余额，金额为 wei 十进制字符串。', z.strictObject({ address: addressSchema }), true,
      async ({ address }) => withProvider(config, async (provider) => ({ chainId: config.chainId, address: getAddress(address), balanceWei: await provider.getBalance(address) }))),
    defineTool('evm_receipt', '读取真实交易回执；尚未取得回执时返回 found=false，不推断交易成功。', z.strictObject({ transactionHash: uidSchema }), true,
      async ({ transactionHash }) => withProvider(config, async (provider) => {
        const receipt = await provider.getTransactionReceipt(transactionHash);
        return { chainId: config.chainId, transactionHash, found: receipt !== null, receipt: receipt?.toJSON() ?? null };
      })),
    defineTool('evm_verify_message', '按 EIP-191 恢复 UTF-8 个人消息签名的 EOA 地址；仅验证 EOA 签名，不执行 EIP-1271。',
      z.strictObject({ message: z.string(), signature: z.string().regex(/^0x[0-9a-fA-F]+$/), expectedSigner: addressSchema }), true,
      async ({ message, signature, expectedSigner }) => {
        const recoveredSigner = verifyMessage(message, signature);
        return { signatureValid: recoveredSigner === getAddress(expectedSigner), recoveredSigner, expectedSigner: getAddress(expectedSigner), verification: 'EIP-191 EOA recovery', trustChecked: false };
      }),
  ];
}
