import type { ToolImplementation } from '../types.js';
import { agentkitTools } from './agentkit.js';
import { bankrTools } from './bankr.js';
import { brianTools } from './brian.js';
import { readWalletConfig, walletConfigurationStatus } from './config.js';
import { goatTools } from './goat.js';
import { meshTools } from './mesh.js';
import { safeTools } from './safe.js';
import { solanaAgentKitTools } from './solana-agent-kit.js';
import { x402Tools } from './x402.js';
import { ccxtTools } from '../trading/ccxt.js';
import { hummingbotTools } from '../trading/hummingbot.js';

export { createElizaPlugin } from '../agents/eliza.js';

export function walletAgentTools(): ToolImplementation[] {
  const config = readWalletConfig();
  return [
    ...agentkitTools(config),
    ...solanaAgentKitTools(config),
    ...safeTools(config),
    ...x402Tools(config),
    ...meshTools(config),
    ...bankrTools(config),
    ...brianTools(config),
    ...goatTools(),
    ...ccxtTools(config),
    ...hummingbotTools(config),
  ];
}

export { walletConfigurationStatus };
export type { WalletConfig } from './config.js';
