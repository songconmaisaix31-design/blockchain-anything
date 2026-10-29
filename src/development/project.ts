import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { z } from 'zod';
import type { Config } from '../config.js';
import { defineTool } from '../types.js';
import { submitSchema, uint256Schema } from '../providers/common.js';
import { resolveWorkingDir, runNpm } from './exec.js';
import { inspectProject } from './workspace.js';

export const projectInitSchema = z.strictObject({
  dir: z.string().min(1), template: z.enum(['counter', 'erc20', 'erc721']).default('counter'),
  name: z.string().min(1).max(100).default('My Token'), symbol: z.string().min(1).max(20).default('TOKEN'),
  supply: uint256Schema.default('1000').describe('ERC20 初始数量，按最小单位计'),
  install: z.boolean().default(true).describe('ERC20/ERC721 项目安装固定版本 OpenZeppelin Contracts'), submit: submitSchema,
});
export const projectRunSchema = z.strictObject({
  dir: z.string().default('.'), action: z.enum(['compile', 'test']), provider: z.enum(['foundry', 'hardhat']).optional(),
  matchPath: z.string().optional(), offline: z.boolean().default(false), timeoutMs: z.number().int().positive().max(600_000).optional(),
});

export function projectTools(config: Config, invoke: (name: string, input: unknown) => Promise<unknown>) {
  return [
    defineTool('project_init', '在新目录创建可编译测试的 Foundry 项目；ERC20/ERC721 复用 OpenZeppelin 5.6.1，不覆盖已有目录。', projectInitSchema, false,
      async ({ dir, template, name, symbol, supply, install }) => {
        const root = await resolveWorkingDir(config);
        const target = resolve(root, dir);
        if (target === root) throw new Error('请指定一个新的子目录，例如 contracts');
        const parent = await resolveWorkingDir(config, dirname(target));
        const cwd = join(parent, relative(dirname(target), target));
        await mkdir(cwd); // 已有目录直接失败，保留原项目。
        await mkdir(join(cwd, 'src')); await mkdir(join(cwd, 'test'));
        const token = template !== 'counter';
        const nft = template === 'erc721';
        const contract = nft ? 'MyNFT' : token ? 'MyToken' : 'Counter';
        const source = nft
          ? `import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";\nimport "@openzeppelin/contracts/access/Ownable.sol";\ncontract MyNFT is ERC721URIStorage, Ownable {\n  constructor() ERC721(unicode${JSON.stringify(name)}, unicode${JSON.stringify(symbol)}) Ownable(msg.sender) {}\n  function safeMint(address to, uint256 tokenId, string memory uri) public onlyOwner {\n    _safeMint(to, tokenId);\n    _setTokenURI(tokenId, uri);\n  }\n}\n`
          : token
          ? `import "@openzeppelin/contracts/token/ERC20/ERC20.sol";\ncontract MyToken is ERC20 {\n  constructor() ERC20(unicode${JSON.stringify(name)}, unicode${JSON.stringify(symbol)}) { _mint(msg.sender, ${supply}); }\n}\n`
          : 'contract Counter {\n  uint256 public value;\n  function increment() external { value++; }\n}\n';
        const test = nft
          ? 'function testMintAndTokenURI() public { MyNFT nft = new MyNFT(); nft.safeMint(address(1), 7, "ipfs://metadata/7"); require(nft.ownerOf(7) == address(1), "owner"); require(keccak256(bytes(nft.tokenURI(7))) == keccak256(bytes("ipfs://metadata/7")), "uri"); }\n  function testDuplicateMintRejected() public { MyNFT nft = new MyNFT(); nft.safeMint(address(1), 7, "uri"); (bool ok,) = address(nft).call(abi.encodeCall(nft.safeMint, (address(1), 7, "uri"))); require(!ok, "duplicate"); }\n  function testNonOwnerRejected() public { MyNFT nft = new MyNFT(); MintCaller caller = new MintCaller(); require(!caller.mint(nft), "unauthorized"); }'
          : token
          ? `function testSupply() public { MyToken token = new MyToken(); require(token.totalSupply() == ${supply}, "supply"); }`
          : 'function testIncrement() public { Counter counter = new Counter(); counter.increment(); require(counter.value() == 1, "increment"); }';
        const header = '// SPDX-License-Identifier: MIT\npragma solidity ^0.8.20;\n';
        await writeFile(join(cwd, `src/${contract}.sol`), header + source, { flag: 'wx' });
        const helper = nft ? 'contract MintCaller { function mint(MyNFT nft) external returns (bool) { (bool ok,) = address(nft).call(abi.encodeCall(nft.safeMint, (address(1), 8, "uri"))); return ok; } }\n' : '';
        await writeFile(join(cwd, `test/${contract}.t.sol`), `${header}import "../src/${contract}.sol";\ncontract ${contract}Test { ${test} }\n${helper}`, { flag: 'wx' });
        await writeFile(join(cwd, 'foundry.toml'), '[profile.default]\nsrc = "src"\ntest = "test"\nsolc_version = "0.8.35"\nlibs = ["lib", "node_modules"]\nremappings = ["@openzeppelin/=node_modules/@openzeppelin/"]\n', { flag: 'wx' });
        await writeFile(join(cwd, '.gitignore'), 'out/\ncache/\nnode_modules/\n.env\n', { flag: 'wx' });
        if (token) {
          await writeFile(join(cwd, 'package.json'), JSON.stringify({ private: true, dependencies: { '@openzeppelin/contracts': '5.6.1' } }, null, 2) + '\n', { flag: 'wx' });
          if (install) {
            try { await runNpm(['install', '--ignore-scripts', '--no-audit', '--no-fund'], cwd); }
            catch (error) { throw new Error(`项目文件已创建于 ${dir}，依赖安装失败；在该目录运行 npm install 后继续，无需重新 init。${error instanceof Error ? error.message : ''}`); }
          }
        }
        return { taskStatus: 'succeeded', directory: cwd, template, contract: `src/${contract}.sol:${contract}`,
          dependency: token ? { name: '@openzeppelin/contracts', version: '5.6.1', installed: install } : null,
          nextCalls: ['compile', 'test'].map((action) => ({ tool: 'project_run', input: { dir, action } })) };
      }),
    defineTool('project_run', '识别已有 Foundry/Hardhat，执行编译或测试；保留原项目、原诊断和失败码。', projectRunSchema, false,
      async ({ dir, action, provider, matchPath, offline, timeoutMs }) => {
        const project = await inspectProject(config, dir);
        const selected = provider ?? project.selected;
        if (!selected) throw new Error(project.ambiguity ?? '未发现 Foundry/Hardhat 项目；先 bca init <新目录>，或指定 provider');
        if (selected === 'hardhat' && offline) throw new Error('offline 仅适用于 Foundry；Hardhat 沿用项目编译器配置');
        if (action === 'compile' && matchPath) throw new Error('matchPath 仅适用于测试');
        const tool = selected === 'foundry' ? `dev_forge_${action === 'compile' ? 'build' : 'test'}` : `dev_hardhat_${action === 'compile' ? 'compile' : 'test'}`;
        return invoke(tool, selected === 'foundry'
          ? { dir, offline, ...(action === 'test' && matchPath ? { matchPath } : {}), ...(timeoutMs ? { timeoutMs } : {}) }
          : { dir, ...(action === 'test' && matchPath ? { path: matchPath } : {}), ...(timeoutMs ? { timeoutMs } : {}) });
      }),
  ];
}
