import { walletAgentTools } from '../../src/wallets/index.js';

// Requires BCA_SAFE_CHAIN_ID=84532, BCA_SAFE_RPC_URL=https://sepolia.base.org,
// BCA_PRIVATE_KEY and BCA_ALLOW_WRITES=true. This signs a Safe transaction
// locally; it never broadcasts or executes it.
const tools = walletAgentTools();
const byName = new Map(tools.map((tool) => [tool.name, tool]));
const sign = byName.get('wallet_safe_sign_transaction');
if (!sign) throw new Error('wallet_safe_sign_transaction missing');
const owner = process.env.BCA_SAFE_OWNER;
if (!owner) throw new Error('Set BCA_SAFE_OWNER to the owner address');
const result = await sign.execute({
  owners: [owner],
  threshold: 1,
  to: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
  valueWei: '1',
  submit: true,
});
console.log(JSON.stringify(result, (_key, value) => typeof value === 'bigint' ? value.toString() : value, 2));
