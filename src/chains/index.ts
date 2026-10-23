import type { ToolImplementation } from '../types.js';
import { aptosTools } from './aptos.js';
import { sasTools } from './sas.js';
import { signTools } from './sign.js';
import { suiTools } from './sui.js';
import { viemTools } from './viem.js';
import { arweaveTools } from '../storage/arweave.js';
import { sealTools } from '../storage/seal.js';
import { walrusTools } from '../storage/walrus.js';

/**
 * 链与存储轨道统一工具工厂。
 *
 * EAS 的 `easTools` 工厂保持不变，由集成轨道与本工厂并列注册。
 * 所有工具在 execute 内读取进程环境并执行真实 SDK/RPC 调用；缺少配置时立即失败。
 */
export function chainStorageTools(): ToolImplementation[] {
  return [
    ...viemTools(),
    ...signTools(),
    ...sasTools(),
    ...suiTools(),
    ...aptosTools(),
    ...walrusTools(),
    ...sealTools(),
    ...arweaveTools(),
  ];
}

export { aptosTools, arweaveTools, sasTools, sealTools, signTools, suiTools, viemTools, walrusTools };
