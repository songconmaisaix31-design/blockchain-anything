import { walletAgentTools } from '../../src/wallets/index.js';

// Requires BCA_SOLANA_RPC_URL. Without BCA_SOLANA_PRIVATE_KEY the read-only call
// uses an ephemeral in-process keypair and never sends a transaction.
const tools = walletAgentTools();
const byName = new Map(tools.map((tool) => [tool.name, tool]));
for (const name of ['wallet_solana_balance', 'wallet_solana_tps']) {
  const tool = byName.get(name);
  if (!tool) throw new Error(`${name} missing`);
  console.log(name, JSON.stringify(await tool.execute({})));
}
