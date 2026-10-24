// Install in the host: npm i solana-agent-kit @solana-agent-kit/plugin-token @solana/web3.js zod-to-json-schema
// Configure BCA_SOLANA_AGENT_MODULE=examples/agents/solana-agent-kit.mjs.
import { SolanaAgentKit, KeypairWallet, createVercelAITools } from 'solana-agent-kit';
import TokenPlugin from '@solana-agent-kit/plugin-token';
import { Keypair } from '@solana/web3.js';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { fromSolanaAgentKit } from '../../dist/index.js';

export default async function actions() {
  if (!process.env.BCA_SOLANA_SECRET_KEY || !process.env.BCA_SOLANA_RPC_URL) throw new Error('Configure a local development BCA_SOLANA_SECRET_KEY (JSON bytes) and BCA_SOLANA_RPC_URL');
  const keypair = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(process.env.BCA_SOLANA_SECRET_KEY)));
  const agent = new SolanaAgentKit(new KeypairWallet(keypair, process.env.BCA_SOLANA_RPC_URL), process.env.BCA_SOLANA_RPC_URL, {}).use(TokenPlugin);
  return fromSolanaAgentKit(createVercelAITools(agent, agent.actions), (schema) => zodToJsonSchema(schema, { $refStrategy: 'none' }));
}
