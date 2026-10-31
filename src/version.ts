import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// 版本号只保留 package.json 一处，避免常量与清单漂移。
// dist/version.js 与 src 同层级上溯一层即为包根目录，安装到 node_modules 后同样成立。
const manifest = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')) as { version?: string };

export const VERSION = manifest.version ?? '0.0.0';
