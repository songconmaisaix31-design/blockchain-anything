import { readConfig } from '../config.js';
import type { Config } from '../config.js';
import type { ToolImplementation } from '../types.js';
import { c2paTools } from './c2pa.js';
import { inTotoTools } from './intoto.js';
import { openLineageTools } from './openlineage.js';
import { openTimestampsTools } from './opentimestamps.js';
import { risc0Tools } from './risc0.js';
import { sigstoreTools } from './sigstore.js';
import { slsaTools } from './slsa.js';
import { cheqdTools } from '../identity/cheqd.js';
import { vcTools } from '../identity/vc.js';

export function provenanceTools(config: Config = readConfig()): ToolImplementation[] {
  return [
    ...openTimestampsTools(config),
    ...risc0Tools(config),
    ...sigstoreTools(config),
    ...slsaTools(config),
    ...inTotoTools(config),
    ...openLineageTools(config),
    ...c2paTools(config),
    ...cheqdTools(config),
    ...vcTools(config),
  ];
}

export { readProvenanceConfig } from './config.js';
export type { ProvenanceConfig } from './config.js';
