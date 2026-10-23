import { walletAgentTools } from '../../src/wallets/index.js';

// Requires BCA_RPC_URL, BCA_CHAIN_ID and BCA_PRIVATE_KEY in the process environment.
const tools = walletAgentTools();
const byName = new Map(tools.map((tool) => [tool.name, tool]));
const wallet = byName.get('wallet_agentkit_wallet');
if (!wallet) throw new Error('wallet_agentkit_wallet missing');
console.log(JSON.stringify(await wallet.execute({}), (_key, value) => typeof value === 'bigint' ? value.toString() : value, 2));
