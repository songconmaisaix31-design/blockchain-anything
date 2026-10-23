import { walletAgentTools } from '../../src/wallets/index.js';

// Requires BCA_X402_PRIVATE_KEY or BCA_PRIVATE_KEY. The default network is the
// x402 Base Sepolia testnet and the asset is the SDK's default USDC entry.
// This creates a signed authorization only; it never settles or moves funds.
const tools = walletAgentTools();
const byName = new Map(tools.map((tool) => [tool.name, tool]));
const support = byName.get('wallet_x402_supported');
const create = byName.get('wallet_x402_create_payment');
if (!support || !create) throw new Error('x402 tools missing');
console.log('supported', JSON.stringify(await support.execute({})));
const payment = await create.execute({
  network: 'eip155:84532',
  amount: '1000',
  payTo: '0x0000000000000000000000000000000000000001',
  resourceUrl: 'https://example.com/resource',
  submit: true,
});
console.log('payment', JSON.stringify(payment, null, 2));
