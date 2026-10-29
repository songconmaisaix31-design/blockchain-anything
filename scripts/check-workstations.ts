import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { JsonRpcProvider } from 'ethers';
import { createToolkit } from '../src/toolkit.js';
import { resolveExecutable } from '../src/development/exec.js';

const mode = process.argv[2] ?? 'all';
assert.ok(['all', 'guides', 'nft', 'slither'].includes(mode));
const repo = process.cwd();
await mkdir(join(repo, '.work'), { recursive: true });
const root = await mkdtemp(join(repo, '.work/workstations-'));
for (const key of Object.keys(process.env)) if (key.startsWith('BCA_') && key !== 'BCA_SOLC_PATH') delete process.env[key];
process.env.BCA_WORKING_ROOT = root;
process.env.BCA_TIMEOUT_MS = '120000';
let toolkit = createToolkit();
const call = (name: string, input: unknown) => toolkit.invoke(name, input) as Promise<any>;

try {
  if (mode === 'all' || mode === 'guides') {
    const nft = await call('workstation_search', { query: '创建 NFT' });
    assert.equal(nft.candidates[0].id, 'nft-create');
    assert.ok(nft.candidates[0].factsNeeded.includes('chainFamily'));
    assert.deepEqual(nft.candidates[0].steps, []);
    const solana = await call('workstation_search', { query: 'Solana NFT' });
    assert.equal(solana.candidates[0].provider, 'solana-agent-kit');
    assert.ok(solana.candidates[0].missingRequirements.some((item: string) => item.includes('plugin-nft')));
    assert.equal(solana.candidates[0].steps[0].tool, 'agent_actions');
    const dune = await call('workstation_search', { query: '用 Dune 查询 Base 最近七天交易量' });
    assert.equal(dune.candidates[0].id, 'onchain-data');
    assert.equal(dune.candidates[0].provider, 'dune');
    assert.ok(dune.candidates[0].missingRequirements.includes('BCA_DUNE_API_KEY'));
    assert.ok(dune.candidates[0].steps.some((step: any) => step.tool === 'bridge_configure'));
    for (const [securityInput, provider] of [['source', 'slither'], ['address', 'goplus'], ['transaction', 'tenderly']]) {
      const guide = await call('workstation_guide', { id: 'security-check', context: { securityInput } });
      assert.equal(guide.provider, provider);
      assert.ok(!guide.steps.some((step: any) => step.tool === 'workstation_diagnose'));
    }
    assert.equal((await call('workstation_search', { query: '写一首生日诗' })).candidates.length, 0);
    await call('project_init', { dir: 'counter', submit: true });
    const compile = await call('workstation_search', { query: '只编译合约', context: { dir: 'counter' } });
    assert.deepEqual(compile.candidates[0].steps.map((step: any) => step.tool), ['dev_forge_build']);
    assert.equal(compile.candidates[0].executable, true);
    assert.deepEqual(compile.candidates[0].missingRequirements, []);
    const compileNft = await call('workstation_search', { query: '只编译 NFT 合约', context: { dir: 'counter', provider: 'foundry' } });
    assert.deepEqual(compileNft.candidates[0].steps.map((step: any) => step.tool), ['dev_forge_build']);
    assert.equal(compileNft.candidates[0].executable, true);
    const mint = await call('workstation_guide', { id: 'nft-create', context: { task: 'mint', chainFamily: 'evm' } });
    assert.ok(!mint.factsNeeded.includes('dir'));
    assert.ok(!mint.steps.some((step: any) => step.tool === 'project_init'));
    const simulation = await call('workstation_search', { query: 'Tenderly 模拟交易' });
    assert.deepEqual(simulation.candidates.map((candidate: any) => candidate.id), ['security-check']);
    assert.equal(simulation.candidates[0].request.securityInput, 'transaction');
    assert.ok(!simulation.candidates[0].factsNeeded.includes('hash'));
    const diagnosis = await call('workstation_search', { query: '交易失败', context: { provider: 'rpc' } });
    assert.equal(diagnosis.candidates[0].steps[0].tool, 'workstation_diagnose');
    const source = await call('workstation_search', { query: '检查合约源码安全', context: { target: 'counter' } });
    assert.deepEqual(source.candidates[0].steps.map((step: any) => step.tool), ['dev_slither_analyze']);
    console.log('工作站选择、缺项和仅编译路径通过');
  }

  if (mode !== 'guides') {
    const initialized = await call('project_init', { dir: 'nft', template: 'erc721', name: 'Workstation NFT', symbol: 'WSNFT', submit: true });
    assert.equal(initialized.contract, 'src/MyNFT.sol:MyNFT');
    for (const action of ['compile', 'test']) {
      const result = await call('project_run', { dir: 'nft', action, offline: true });
      assert.equal(result.taskStatus, 'succeeded', JSON.stringify(result));
    }
    console.log('OpenZeppelin ERC721 项目编译、铸造权限与元数据测试通过');
  }

  if (mode === 'all' || mode === 'nft') {
    await toolkit.close();
    const socket = createServer();
    await new Promise<void>((done) => socket.listen(0, '127.0.0.1', done));
    const port = (socket.address() as { port: number }).port;
    await new Promise<void>((done) => socket.close(() => done()));
    const node = spawn(resolveExecutable('anvil'), ['--host', '127.0.0.1', '--port', String(port), '--chain-id', '31337'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    node.stdout.on('data', (chunk) => { output += chunk; }); node.stderr.on('data', (chunk) => { output += chunk; });
    process.env.BCA_RPC_URL = `http://127.0.0.1:${port}`;
    process.env.BCA_CHAIN_ID = '31337'; process.env.BCA_ALLOW_WRITES = 'true';
    const rpc = new JsonRpcProvider(process.env.BCA_RPC_URL, 31337, { staticNetwork: true, cacheTimeout: -1 });
    toolkit = createToolkit();
    try {
      const deadline = Date.now() + 15000;
      while (!output.includes('Listening on') && node.exitCode === null && Date.now() < deadline) await new Promise((done) => setTimeout(done, 50));
      assert.match(output, /Listening on/);
      const owner = await (await rpc.getSigner(0)).getAddress();
      const recipient = await (await rpc.getSigner(1)).getAddress();
      const deployed = await call('dev_forge_deploy_local', { dir: 'nft', contract: 'src/MyNFT.sol:MyNFT', from: owner, submit: true });
      assert.equal(deployed.taskStatus, 'succeeded', JSON.stringify(deployed));
      const address = deployed.deployment.deployedTo;
      const tokenUri = 'data:application/json,{"name":"Workstation NFT #7"}';
      await assert.rejects(() => call('dev_erc721_mint_local', { address, from: recipient, recipient, tokenId: '7', tokenUri, submit: true }));
      const minted = await call('dev_erc721_mint_local', { address, from: owner, recipient, tokenId: '7', tokenUri, submit: true });
      assert.equal(minted.taskStatus, 'succeeded', JSON.stringify(minted));
      assert.equal(minted.owner.toLowerCase(), recipient.toLowerCase());
      const artifact = JSON.parse(await readFile(join(root, 'nft/out/MyNFT.sol/MyNFT.json'), 'utf8'));
      const uri = await call('viem_read', { address, abi: artifact.abi, functionName: 'tokenURI', args: ['7'] });
      assert.equal(uri.result, tokenUri);
      await assert.rejects(() => call('dev_erc721_mint_local', { address, from: owner, recipient, tokenId: '7', tokenUri: 'duplicate', submit: true }));
      await assert.rejects(() => call('dev_erc721_mint_local', { address: recipient, from: owner, recipient, tokenId: '8', tokenUri: 'uri', submit: true }), /没有合约代码/);
      console.log(JSON.stringify({ network: 'local Anvil', chainId: 31337, contract: address, mintHash: minted.hash, owner: minted.owner, tokenUri: uri.result }));
    } finally {
      await toolkit.close(); rpc.destroy();
      if (node.exitCode === null) { const closed = once(node, 'close'); node.kill(); await closed; }
    }
    delete process.env.BCA_RPC_URL; delete process.env.BCA_CHAIN_ID; delete process.env.BCA_ALLOW_WRITES;
    toolkit = createToolkit();
  }

  if (mode === 'all' || mode === 'slither') {
    const analyzed = await call('dev_slither_analyze', { target: 'nft', timeoutMs: 120000 });
    assert.equal(analyzed.taskStatus, 'succeeded', JSON.stringify(analyzed));
    assert.equal(analyzed.result.success, true);
    assert.ok(Array.isArray(analyzed.result.results.detectors));
    console.log(JSON.stringify({ analyzer: 'Slither', exitCode: analyzed.exitCode, findings: analyzed.result.results.detectors.length, target: resolve(root, 'nft') }));
  }
  console.log(`实际项目保留于 ${root}`);
} finally { await toolkit.close(); }
