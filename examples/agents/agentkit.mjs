// Install in the host project: npm i @coinbase/agentkit zod-to-json-schema
// Configure BCA_AGENTKIT_MODULE=examples/agents/agentkit.mjs.
import { AgentKit, ViemWalletProvider, walletActionProvider } from '@coinbase/agentkit';
import { createWalletClient, createPublicClient, http, defineChain } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { fromAgentKit } from '../../dist/index.js';

export default async function actions() {
  if (!process.env.BCA_RPC_URL || !process.env.BCA_CHAIN_ID || !process.env.BCA_PRIVATE_KEY) throw new Error('Configure BCA_RPC_URL, BCA_CHAIN_ID and a local development BCA_PRIVATE_KEY');
  const chainId = Number(process.env.BCA_CHAIN_ID);
  if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new Error('Invalid chain ID');
  const transport = http(process.env.BCA_RPC_URL, { timeout: 15000, retryCount: 0 });
  if (await createPublicClient({ transport }).getChainId() !== chainId) throw new Error('Chain ID mismatch');
  const chain = defineChain({ id: chainId, name: 'Operator configured EVM', nativeCurrency: { name: 'Native', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [process.env.BCA_RPC_URL] } } });
  const wallet = createWalletClient({ account: privateKeyToAccount(process.env.BCA_PRIVATE_KEY), chain, transport });
  const kit = await AgentKit.from({ walletProvider: new ViemWalletProvider(wallet), actionProviders: [walletActionProvider()] });
  return fromAgentKit(kit, (schema) => zodToJsonSchema(schema, { $refStrategy: 'none' }));
}
