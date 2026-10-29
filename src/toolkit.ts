import { readConfig } from './config.js';
import { bridgeTools } from './bridge/index.js';
import { BridgeSessions } from './bridge/session.js';
import { catalogTools, metadataFor } from './workstations/catalog.js';
import { evmWorkstationTools } from './workstations/evm.js';
import { workspaceTools } from './development/workspace.js';
import { setupTools } from './setup.js';
import { projectTools } from './development/project.js';
import { bridgeManagementTools } from './bridge/manage.js';
import { searchTools } from './workstations/search.js';
import { chainTools } from './chains/index.js';
import { developmentTools } from './development/index.js';
import { agentTools } from './agents/index.js';
import { storageTools } from './storage/index.js';
import { walletTools } from './wallets/index.js';
import { tradingTools } from './trading/index.js';
import { provenanceTools } from './provenance/index.js';
import { identityTools } from './identity/index.js';
import { safeError, serializable } from './providers/common.js';
import { contentTools } from './providers/content.js';
import { easTools } from './providers/eas.js';
import { evmTools } from './providers/evm.js';
import { ipfsTools } from './providers/ipfs.js';
import { goplusTools } from './providers/goplus.js';
import type { Toolkit } from './types.js';

export function createToolkit(): Toolkit {
  const config = readConfig();
  const sessions = new BridgeSessions(config);
  let toolkit: Toolkit;
  const invoke = (name: string, input: unknown) => toolkit.invoke(name, input);
  const implementations = [...evmTools(config), ...easTools(config), ...contentTools(config), ...ipfsTools(config), ...goplusTools(config), ...bridgeTools(config, sessions), ...developmentTools(config), ...chainTools(config), ...storageTools(config), ...walletTools(config), ...tradingTools(config), ...provenanceTools(config), ...identityTools(config), ...agentTools(config)];
  implementations.push(...projectTools(config, invoke), ...bridgeManagementTools(config), ...workspaceTools(config), ...evmWorkstationTools(config, invoke), ...setupTools(config, invoke));
  implementations.push(...catalogTools(config, () => toolkit.tools), ...searchTools(config, () => toolkit.tools, sessions));
  const tools = implementations.map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema, readOnly: tool.readOnly, metadata: metadataFor(tool) }));
  const byName = new Map(implementations.map((tool) => [tool.name, tool]));
  toolkit = {
    tools,
    close: () => sessions.closeAll(),
    async invoke(name, input) {
      const tool = byName.get(name);
      if (!tool) throw new Error(`未知工具：${name}`);
      try {
        return serializable(await tool.execute(input));
      } catch (error) {
        throw safeError(error, config);
      }
    },
  };
  return toolkit;
}
