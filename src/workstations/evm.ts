import { createHash } from 'node:crypto';
import { z } from 'zod';
import { decodeErrorResult, decodeFunctionData, getAddress, type Abi, type Address, type Hash } from 'viem';
import { Interface } from 'ethers';
import type { Config } from '../config.js';
import { defineTool } from '../types.js';
import { addressSchema, uidSchema, safeError } from '../providers/common.js';
import { readWorkingFile } from '../providers/files.js';
import { withClient } from '../chains/viem.js';
import { withProvider } from '../providers/evm.js';
import { VERSION } from '../version.js';

const implementationSlot = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
const beaconSlot = '0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50';
const blockSchema = z.string().regex(/^(0|[1-9][0-9]*)$/).optional();
const timestamp = () => new Date().toISOString();

type SourceInfo = { id: number; content?: string | null };
type Contract = { name: string; file?: string; abi: Abi; deployedBytecode: string; sourceMap?: string };
type Artifact = { contracts: Contract[]; sources?: Record<string, SourceInfo> };
type Invoke = (name: string, input: unknown) => Promise<unknown>;

async function source(config: Config, address: Address, block: bigint, artifactPath?: string, contractName?: string) {
  if (artifactPath) {
    const bytes = await readWorkingFile(config, artifactPath);
    const artifact = JSON.parse(bytes.toString('utf8')) as Artifact;
    if (!Array.isArray(artifact.contracts)) throw new Error('artifact 必须是 dev_solidity_compile 的完整结果 JSON');
    const code = await withClient(config, (client) => client.getBytecode({ address, blockNumber: block }));
    const matches = artifact.contracts.filter((item) => (!contractName || item.name === contractName) && item.deployedBytecode?.toLowerCase() === code?.toLowerCase() && code !== '0x');
    if (matches.length !== 1) return { source: 'local artifact', artifactPath, bytecodeMatched: false, found: false, reason: '固定区块代码未唯一匹配；含 immutable/link reference 的产物需通过官方验证工具处理', fetchedAt: timestamp() };
    return { source: 'local artifact', artifactPath, artifactSha256: createHash('sha256').update(bytes).digest('hex'), bytecodeMatched: true,
      found: true, contract: matches[0]!, sources: artifact.sources ?? {}, blockNumber: String(block), fetchedAt: timestamp() };
  }
  const url = `https://sourcify.dev/server/v2/contract/${config.chainId}/${address}?fields=abi,sources,compilation,runtimeBytecode`;
  const response = await fetch(url, { signal: AbortSignal.timeout(config.timeoutMs), headers: { 'User-Agent': `blockchain-anything/${VERSION} (+https://github.com/songconmaisaix31-design/blockchain-anything)` } });
  if (response.status === 404) return { source: 'Sourcify v2', found: false, fetchedAt: timestamp() };
  if (!response.ok) throw new Error(`Sourcify v2 查询失败 HTTP ${response.status}；未推断为不存在`);
  const raw = await response.json() as Record<string, any>;
  const code = await withClient(config, (client) => client.getBytecode({ address, blockNumber: block }));
  const bytecodeMatched = !!code && code !== '0x' && typeof raw.runtimeBytecode?.onchainBytecode === 'string' && raw.runtimeBytecode.onchainBytecode.toLowerCase() === code.toLowerCase();
  return { source: 'Sourcify v2', found: true, raw, bytecodeMatched, fetchedAt: timestamp(), blockNumber: String(block),
    contract: bytecodeMatched ? { name: raw.compilation?.name ?? address, abi: raw.abi ?? [], deployedBytecode: code! } as Contract : undefined,
    note: '保留官方原始结果；只有固定区块 runtime bytecode 一致时将 ABI 用于诊断' };
}

function sourceLocation(contract: Contract, sources: Record<string, SourceInfo>, pc: number) {
  if (!contract.sourceMap) return null;
  // Solidity's official source-map format indexes instructions, not bytes.
  const bytecode = Buffer.from(contract.deployedBytecode.replace(/^0x/, ''), 'hex');
  let index = 0;
  for (let cursor = 0; cursor < pc && cursor < bytecode.length; index++) {
    const opcode = bytecode[cursor]!;
    cursor += opcode >= 0x60 && opcode <= 0x7f ? opcode - 0x5f + 1 : 1;
  }
  const fields = ['0', '0', '-1'];
  const mappings = contract.sourceMap.split(';');
  for (let i = 0; i <= index && i < mappings.length; i++) {
    mappings[i]!.split(':').slice(0, 3).forEach((value, j) => { if (value) fields[j] = value; });
  }
  const file = Object.entries(sources).find(([, value]) => value.id === Number(fields[2]));
  if (!file?.[1].content) return null;
  const offset = Number(fields[0]); const length = Number(fields[1]);
  const bytes = Buffer.from(file[1].content);
  return { file: file[0], byteOffset: offset, byteLength: length, line: bytes.subarray(0, offset).toString().split('\n').length,
    excerpt: bytes.subarray(offset, offset + length).toString().slice(0, 1200), pc, evidence: 'matching runtime bytecode + solc sourceMap + trace PC' };
}

export function evmWorkstationTools(config: Config, invoke: Invoke) {
  return [
    defineTool('evm_proxy', '在固定区块检查 ERC-1967 implementation/beacon slot 与标准 ERC-1167 字节码。其他模式保持未知。',
      z.strictObject({ address: addressSchema, block: blockSchema }), true, async ({ address, block }) => withClient(config, async (client) => {
        const blockNumber = block ? BigInt(block) : await client.getBlockNumber();
        const params = { address: address as Address, blockNumber };
        const [code, implementation, beacon] = await Promise.all([client.getBytecode(params), client.getStorageAt({ ...params, slot: implementationSlot }), client.getStorageAt({ ...params, slot: beaconSlot })]);
        const fromSlot = (slot: string | undefined) => slot && BigInt(slot) !== 0n ? getAddress(`0x${slot.slice(-40)}`) : null;
        const clone = /^0x363d3d373d3d3d363d73([0-9a-f]{40})5af43d82803e903d91602b57fd5bf3$/i.exec(code ?? '');
        const target = clone ? getAddress(`0x${clone[1]}`) : fromSlot(implementation);
        return { chainId: config.chainId, address, blockNumber, source: 'eth_getCode / eth_getStorageAt', fetchedAt: timestamp(),
          pattern: clone ? 'ERC-1167' : target ? 'ERC-1967' : fromSlot(beacon) ? 'ERC-1967-beacon-unsupported' : 'unrecognized',
          implementation: target, beacon: fromSlot(beacon), codePresent: !!code && code !== '0x',
          limitation: '只检查单层标准模式；未命中不能证明非代理。交易中升级或同区块升级需 trace 确认实际实现地址。' };
      })),
    defineTool('evm_contract_source', '读取本地编译结果或 Sourcify v2 源码/ABI；与固定区块链上 runtime bytecode 对照。',
      z.strictObject({ address: addressSchema, block: blockSchema, artifact: z.string().optional(), contractName: z.string().optional() }), true,
      async ({ address, block, artifact, contractName }) => {
        const number = block ? BigInt(block) : await withClient(config, (client) => client.getBlockNumber());
        return { chainId: config.chainId, address, ...(await source(config, address as Address, number, artifact, contractName)) };
      }),
    defineTool('evm_trace', '调用配置 RPC 的 debug_traceTransaction；返回原始执行 trace 与链/区块证据。未支持时明确失败，不自动重放。',
      z.strictObject({ hash: uidSchema, mode: z.enum(['structLogs', 'callTracer']).default('structLogs') }), true,
      async ({ hash, mode }) => withProvider(config, async (provider) => {
        const receipt = await provider.getTransactionReceipt(hash);
        if (!receipt) throw new Error('尚无回执，无法取得已入块 trace');
        const options = mode === 'callTracer' ? { tracer: 'callTracer' } : { disableStorage: true, disableMemory: true, disableStack: true };
        const trace = await provider.send('debug_traceTransaction', [hash, options]);
        return { chainId: config.chainId, hash, blockNumber: String(receipt.blockNumber), blockHash: receipt.blockHash, source: `RPC debug_traceTransaction/${mode}`, fetchedAt: timestamp(), trace };
      })),
    defineTool('workstation_diagnose', 'EVM 交易诊断：查询状态、固定区块源码/代理/trace，返回证据和缺口；不签署、不自动重发。',
      z.strictObject({ hash: uidSchema, artifact: z.string().optional(), contractName: z.string().optional() }), true,
      async ({ hash, artifact, contractName }) => {
        const state = await invoke('viem_transaction', { hash }) as any;
        const evidence: unknown[] = [{ chainId: config.chainId, hash, blockNumber: state.receipt?.blockNumber ?? null, blockHash: state.receipt?.blockHash ?? null, source: 'viem transaction + receipt', fetchedAt: timestamp() }];
        const gaps: string[] = [];
        const result: Record<string, any> = { status: state.status, transaction: state.transaction, receipt: state.receipt, evidence, gaps, diagnosis: null, complete: false };
        if (!state.receipt || !state.transaction?.to) { gaps.push('需要已入块的合约调用交易及回执'); return result; }
        const block = state.receipt.blockNumber;
        let proxy: any;
        try { proxy = await invoke('evm_proxy', { address: state.transaction.to, block }); result.proxy = proxy; evidence.push(proxy); }
        catch (error) { gaps.push(`代理识别：${safeError(error, config).message}`); }
        let sourceResult: any;
        try {
          sourceResult = await invoke('evm_contract_source', { address: proxy?.implementation ?? state.transaction.to, block, artifact, contractName });
          result.source = sourceResult;
          evidence.push({ chainId: config.chainId, hash, blockNumber: block, source: sourceResult.source, fetchedAt: sourceResult.fetchedAt, artifactSha256: sourceResult.artifactSha256 });
          if (!sourceResult.bytecodeMatched) gaps.push('源码/ABI 尚未与该区块的实现代码匹配');
        } catch (error) { gaps.push(`源码：${safeError(error, config).message}`); }
        let traced: any;
        try { traced = await invoke('evm_trace', { hash }); result.trace = traced; evidence.push({ ...traced, trace: undefined }); }
        catch (error) {
          gaps.push(`structLogs：${safeError(error, config).message}`);
          try { traced = await invoke('evm_trace', { hash, mode: 'callTracer' }); result.trace = traced; evidence.push({ ...traced, trace: undefined }); }
          catch (fallback) { gaps.push(`callTracer：${safeError(fallback, config).message}；可使用已授权 Tenderly bridge，或宿主在固定区块 fork 重放。`); }
        }
        const contract = sourceResult?.bytecodeMatched ? sourceResult.contract as Contract : undefined;
        if (contract) {
          try { result.call = decodeFunctionData({ abi: contract.abi, data: state.transaction.input }); }
          catch { gaps.push('输入未能通过匹配 ABI 解码'); }
        }
        if (state.status === 'failed' && traced) {
          const raw = traced.trace;
          let data = raw.returnValue ?? raw.output ?? '0x';
          if (!data.startsWith('0x')) data = `0x${data}`;
          let decoded: unknown;
          try { decoded = decodeErrorResult({ abi: contract?.abi ?? [], data: data as Hash }); } catch { /* retain raw revert */ }
          if (!decoded) {
            try { const parsed = new Interface(['error Error(string)', 'error Panic(uint256)']).parseError(data); if (parsed) decoded = { errorName: parsed.name, args: Array.from(parsed.args) }; } catch { /* no invented reason */ }
          }
          const logs = raw.structLogs as { op: string; pc: number; depth: number }[] | undefined;
          const terminal = logs?.at(-1);
          const rootDepth = logs?.[0]?.depth;
          const directTrace = logs?.every((step) => step.depth === rootDepth);
          const location = contract && directTrace && terminal?.op === 'REVERT' && terminal.depth === rootDepth && !proxy?.implementation
            ? sourceLocation(contract, sourceResult.sources ?? {}, terminal.pc) : null;
          result.diagnosis = { reverted: true, decodedError: decoded ?? null, returnData: data, sourceLocation: location,
            failingCall: result.call ?? null, conclusion: decoded ? '已从该交易 trace 的返回数据解码 revert' : '回执确认失败；trace 未提供可解码根因',
            nextAction: decoded ? '宿主根据解码参数与源码条件修复输入或合约；仅复测相关路径。' : '补充匹配 ABI、完整调用树或历史状态，保留根因未知。' };
          if (!location) gaps.push('尚无可核对源码位置；嵌套调用/代理需匹配实际执行实现与相应深度 trace');
          result.complete = !!decoded && !!location;
        }
        return result;
      }),
  ];
}
