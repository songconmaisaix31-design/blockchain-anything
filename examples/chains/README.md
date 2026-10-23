# 链与存储示例

这些示例直接调用 `chainStorageTools()`，不经过 CLI/MCP 适配层，用于演示集成后的 TypeScript 用法。

```powershell
# 仅列出工具，不连接网络
npx tsx -e "import { chainStorageTools } from './src/chains/index.ts'; console.log(chainStorageTools().map(t => t.name))"

# 按当前进程环境逐个执行只读检查；未配置的服务会打印真实错误并继续
npx tsx examples/chains/read-only.ts
```

配置示例（按需设置，未设置的服务不会被静默切换到其他网络）：

```powershell
$env:BCA_RPC_URL = 'https://sepolia.drpc.org'
$env:BCA_CHAIN_ID = '11155111'
$env:BCA_SUI_NETWORK = 'mainnet'
$env:BCA_SUI_RPC_URL = 'https://fullnode.mainnet.sui.io:443'
$env:BCA_APTOS_NETWORK = 'mainnet'
$env:BCA_APTOS_NODE_URL = 'https://fullnode.mainnet.aptoslabs.com/v1'
$env:BCA_SOLANA_RPC_URL = 'https://api.mainnet-beta.solana.com'
$env:BCA_ARWEAVE_GATEWAY = 'https://arweave.net'
npx tsx examples/chains/read-only.ts
```

EAS 写入与 PrivateData 的真实验证由 `scripts/check-chains.ts --scope eas` 在本地 Anvil 完成；示例不执行写入或付费操作。完整工具、配置和验证结果见 [链与存储接入](../../docs/integrations/chains-storage.md)。
