import { readConfig, type Config } from '../config.js';
import type { ToolImplementation } from '../types.js';
import { loadDevelopmentConfig } from './config.js';
import { foundryTools } from './foundry.js';
import { hardhatTools } from './hardhat.js';
import { skillsTools } from './skills.js';
import { slitherTools } from './slither.js';
import { statusTools } from './status.js';

/**
 * Development tools for Foundry, Hardhat, Slither and official Agent Skills.
 * Passing a Config keeps the shared toolkit consistent; calling without an
 * argument reads the process configuration directly.
 */
export function developmentTools(config: Config = readConfig()): ToolImplementation[] {
  const dev = loadDevelopmentConfig(config);
  return [
    ...statusTools(dev),
    ...foundryTools(dev),
    ...hardhatTools(dev),
    ...slitherTools(dev),
    ...skillsTools(dev),
  ];
}

export { loadDevelopmentConfig } from './config.js';
export type { DevelopmentConfig } from './config.js';
export { SKILL_SOURCES } from './skills.js';
export type { SkillSource } from './skills.js';
