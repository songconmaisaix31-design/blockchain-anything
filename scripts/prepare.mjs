import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Build source checkouts and Git installs. npm 10 can invoke prepare again when
// setup repacks an installed tarball, whose dist is already built.
const root = fileURLToPath(new URL('../', import.meta.url));
if (existsSync(new URL('../tsconfig.json', import.meta.url))) {
  const result = spawnSync(process.execPath, [process.env.npm_execpath, 'run', 'build'], { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} else if (!existsSync(new URL('../dist/cli/main.js', import.meta.url))) {
  throw new Error('BCA package is missing its built CLI');
}
