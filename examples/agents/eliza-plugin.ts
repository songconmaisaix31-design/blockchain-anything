import { AgentRuntime } from '@elizaos/core';
import { createElizaPlugin } from '../../src/agents/eliza.js';
import { walletAgentTools } from '../../src/wallets/index.js';

const tools = walletAgentTools();
const plugin = createElizaPlugin(tools);
const runtime = new AgentRuntime({
  character: { name: 'BCA', bio: ['Blockchain Anything tools'], templates: {}, messageExamples: [], postExamples: [], topics: [], adjectives: [], knowledge: [], plugins: [], secrets: {} },
  logLevel: 'error',
});
await runtime.registerPlugin(plugin as never);
console.log(JSON.stringify({ plugin: plugin.name, actions: runtime.actions.map((action) => action.name) }, null, 2));

if (process.argv.includes('--invoke')) {
  const action = runtime.actions.find((candidate) => candidate.name === 'BCA_WALLET_GOAT_STATUS');
  if (!action) throw new Error('BCA_WALLET_GOAT_STATUS not registered');
  const result = await action.handler(runtime, {} as never, undefined, { parameters: {} });
  console.log(JSON.stringify(result, null, 2));
}
