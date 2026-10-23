import { readConfig } from './config.js';
import { bridgeTools } from './bridge/index.js';
import { chainTools } from './chains/index.js';
import { developmentTools } from './development/index.js';
import { safeError, serializable } from './providers/common.js';
import { contentTools } from './providers/content.js';
import { easTools } from './providers/eas.js';
import { evmTools } from './providers/evm.js';
import { ipfsTools } from './providers/ipfs.js';
import type { Toolkit } from './types.js';

export function createToolkit(): Toolkit {
  const config = readConfig();
  const implementations = [...evmTools(config), ...easTools(config), ...contentTools(config), ...ipfsTools(config), ...bridgeTools(config), ...developmentTools(config), ...chainTools(config)];
  const tools = implementations.map(({ name, description, inputSchema, readOnly }) => ({ name, description, inputSchema, readOnly }));
  const byName = new Map(implementations.map((tool) => [tool.name, tool]));
  return {
    tools,
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
}
