import type { Config } from '../config.js';
import { viemTools } from './viem.js';
import { multichainTools } from './multichain.js';

export function chainTools(config: Config) {
  return [...viemTools(config), ...multichainTools(config)];
}
