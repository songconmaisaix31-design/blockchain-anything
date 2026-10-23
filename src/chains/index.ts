import type { Config } from '../config.js';
import { viemTools } from './viem.js';

export function chainTools(config: Config) {
  return [...viemTools(config)];
}
