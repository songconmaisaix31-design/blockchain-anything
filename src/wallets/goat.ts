import { z } from 'zod';
import { defineTool } from '../types.js';

export function goatTools() {
  return [
    defineTool(
      'wallet_goat_status',
      '报告 GOAT SDK 的官方归档/维护状态和迁移范围；不加载 GOAT 依赖，不执行链上操作。',
      z.strictObject({}),
      true,
      async () => ({
        project: 'GOAT SDK',
        repository: 'https://github.com/goat-sdk/goat',
        npmPackage: '@goat-sdk/core',
        npmVersion: '0.5.0',
        readmeStatus: 'Archived read-only historical snapshot; no longer actively maintained',
        githubArchivedFlagObserved: false,
        githubLastPushObserved: '2026-07-02T19:10:23Z',
        checkedAt: '2026-10-23',
        integrated: false,
        reason: '上游 README 明确归档；不把旧库作为新的长期运行依赖，也不声称其已恢复维护',
        migration: [
          'EVM 钱包与交易：Coinbase AgentKit / viem',
          'Solana 钱包与交易：Solana Agent Kit / @solana/web3.js',
          'Safe 多签：@safe-global/protocol-kit',
          'x402 支付：@x402/core 与 @x402/evm',
        ],
        limitation: '保留原生兼容与迁移说明；未验证 GOAT 运行时，未新增 GOAT 依赖',
      }),
    ),
  ];
}
