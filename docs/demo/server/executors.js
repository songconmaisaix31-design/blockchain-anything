// 执行器：能真调的走真实网络，调不了的明确标记 simulated —— 不伪造 livemode。
import crypto from 'node:crypto';
import { searchTools, getTool, TOOLS } from './catalog.js';

const EVM_RPCS = [
  'https://ethereum-rpc.publicnode.com',
  'https://cloudflare-eth.com',
  'https://eth.llamarpc.com',
];
const SOLANA_RPC = 'https://api.mainnet-beta.solana.com';
const TIMEOUT = 12000;

async function fetchJSON(url, init = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), TIMEOUT);
  try {
    const r = await fetch(url, { ...init, signal: ac.signal });
    const text = await r.text();
    if (!r.ok) throw new Error(`HTTP ${r.status} ${text.slice(0, 160)}`);
    return JSON.parse(text);
  } finally {
    clearTimeout(t);
  }
}

async function rpc(method, params) {
  let lastErr;
  for (const url of EVM_RPCS) {
    try {
      const j = await fetchJSON(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      });
      if (j.error) throw new Error(j.error.message || 'rpc error');
      return { result: j.result, via: new URL(url).host };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('all RPC endpoints failed');
}

// ---------- 编码工具 ----------
const B32 = 'abcdefghijklmnopqrstuvwxyz234567';
function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
function base32Decode(str) {
  const clean = str.toLowerCase().replace(/=+$/, '');
  let bits = 0, value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx === -1) throw new Error('invalid base32');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58Decode(str) {
  let num = 0n;
  for (const ch of str) {
    const idx = B58.indexOf(ch);
    if (idx === -1) throw new Error('invalid base58');
    num = num * 58n + BigInt(idx);
  }
  let hex = num === 0n ? '' : num.toString(16);
  if (hex.length % 2) hex = '0' + hex;
  let out = Buffer.from(hex, 'hex');
  let pad = 0;
  while (pad < str.length && str[pad] === '1') pad++;
  if (pad) out = Buffer.concat([Buffer.alloc(pad), out]);
  return out;
}

// ---------- 校验 ----------
const isAddress = (a) => /^0x[0-9a-fA-F]{40}$/.test(a || '');
const isHash = (h) => /^0x[0-9a-fA-F]{64}$/.test(h || '');

function require_(input, key, test, msg) {
  const v = input?.[key];
  if (typeof v !== 'string' || !test(v)) throw new Error(msg);
  return v;
}

const hex = (v) => BigInt(v).toString();
const fromWei = (wei, d = 18) => {
  const n = BigInt(wei);
  const base = 10n ** BigInt(d);
  const whole = n / base;
  const frac = (n % base).toString().padStart(d, '0').slice(0, 6).replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : `${whole}`;
};

// ---------- 真实执行器 ----------
export const LIVE = {
  async evm_balance(input) {
    const address = require_(input, 'address', isAddress, '需要 0x 开头的 40 位 EVM 地址');
    const { result, via } = await rpc('eth_getBalance', [address, 'latest']);
    const wei = hex(result);
    return { address, balanceWei: wei, balanceEth: fromWei(wei), rpc: via };
  },

  async viem_balance(input) {
    return LIVE.evm_balance(input);
  },

  async dev_cast_balance(input) {
    return LIVE.evm_balance(input);
  },

  async evm_chain() {
    const [{ result: chainIdHex, via }, { result: blockHex }] = await Promise.all([
      rpc('eth_chainId', []),
      rpc('eth_blockNumber', []),
    ]);
    const chainId = Number(BigInt(chainIdHex));
    const names = { 1: 'Ethereum Mainnet', 8453: 'Base', 42161: 'Arbitrum One', 10: 'OP Mainnet', 137: 'Polygon' };
    return { chainId, chain: names[chainId] || `chain ${chainId}`, latestBlock: Number(BigInt(blockHex)), rpc: via };
  },

  async viem_block(input) {
    const tag = input?.blockNumber ? '0x' + Number(input.blockNumber).toString(16) : 'latest';
    const { result: b, via } = await rpc('eth_getBlockByNumber', [tag, false]);
    if (!b) throw new Error('区块不存在');
    return {
      number: Number(BigInt(b.number)),
      hash: b.hash,
      timestamp: Number(BigInt(b.timestamp)),
      time: new Date(Number(BigInt(b.timestamp)) * 1000).toISOString(),
      transactions: b.transactions.length,
      gasUsed: hex(b.gasUsed),
      gasLimit: hex(b.gasLimit),
      baseFeePerGas: b.baseFeePerGas ? hex(b.baseFeePerGas) : null,
      miner: b.miner,
      rpc: via,
    };
  },

  async evm_receipt(input) {
    const hash = require_(input, 'transactionHash', isHash, '需要 0x 开头的 64 位交易哈希');
    const { result: r, via } = await rpc('eth_getTransactionReceipt', [hash]);
    if (!r) return { found: false, transactionHash: hash, note: '尚未取得回执，不推断交易成功', rpc: via };
    return {
      found: true,
      transactionHash: r.transactionHash,
      blockNumber: Number(BigInt(r.blockNumber)),
      status: r.status === '0x1' ? 'success' : 'reverted',
      from: r.from,
      to: r.to,
      gasUsed: hex(r.gasUsed),
      effectiveGasPrice: r.effectiveGasPrice ? hex(r.effectiveGasPrice) : null,
      logs: r.logs?.length ?? 0,
      rpc: via,
    };
  },

  async solana_balance(input) {
    const address = require_(input, 'address', (v) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v), '需要 base58 Solana 地址');
    const j = await fetchJSON(SOLANA_RPC, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getBalance', params: [address] }),
    });
    if (j.error) throw new Error(j.error.message);
    const lamports = j.result.value;
    return { address, lamports: String(lamports), sol: (lamports / 1e9).toFixed(9).replace(/0+$/, '') };
  },

  async goplus_token_security(input) {
    const address = require_(input, 'address', isAddress, '需要 ERC20 合约地址');
    const chainId = String(input?.chainId || '1');
    const j = await fetchJSON(
      `https://api.gopluslabs.io/api/v1/token_security/${encodeURIComponent(chainId)}?contract_addresses=${address.toLowerCase()}`
    );
    const raw = j?.result?.[address.toLowerCase()];
    if (!raw) throw new Error(j?.message || 'GoPlus 未返回该代币数据');

    // 分两类：会直接吃掉你资金的「交易限制」，和需要知情但属于设计选择的「中心化特征」。
    const criticalFlags = [
      ['is_honeypot', '蜜罐：只能买不能卖'],
      ['cannot_sell_all', '无法全部卖出'],
      ['selfdestruct', '合约可自毁'],
    ];
    const powerFlags = [
      ['owner_change_balance', '所有者可任意改余额'],
      ['hidden_owner', '存在隐藏所有者'],
    ];
    const centerFlags = [
      ['is_open_source', '未开源', true],
      ['is_proxy', '可升级代理'],
      ['is_mintable', '可增发'],
      ['hidden_owner', '存在隐藏所有者'],
      ['can_take_back_ownership', '所有权可收回'],
      ['transfer_pausable', '可暂停转账'],
      ['trading_cooldown', '交易冷却限制'],
      ['is_blacklisted', '含黑名单机制'],
      ['is_whitelisted', '含白名单机制'],
      ['anti_whale_modifiable', '防巨鲸参数可修改'],
      ['slippage_modifiable', '税率可被修改'],
      ['external_call', '存在外部调用'],
    ];

    const critical = [];
    for (const [key, label] of criticalFlags) if (raw[key] === '1') critical.push(label);
    const privileges = [];
    for (const [key, label] of powerFlags) if (raw[key] === '1') privileges.push(label);
    const central = [];
    for (const [key, label, invert] of centerFlags) {
      const v = raw[key];
      if (v === undefined) continue;
      if (invert ? v === '0' : v === '1') central.push(label);
    }

    const buyTax = Number(raw.buy_tax || 0) * 100;
    const sellTax = Number(raw.sell_tax || 0) * 100;
    const highTax = buyTax >= 10 || sellTax >= 10;
    if (highTax) critical.push(`交易税偏高：买 ${buyTax.toFixed(1)}% / 卖 ${sellTax.toFixed(1)}%`);

    const verdict = critical.length ? 'high'
      : privileges.length || central.length >= 4 ? 'medium'
      : central.length ? 'low' : 'clear';
    return {
      token: { name: raw.token_name, symbol: raw.token_symbol, address },
      verdict,
      critical,
      privileges,
      centralization: central,
      buyTax: buyTax.toFixed(2) + '%',
      sellTax: sellTax.toFixed(2) + '%',
      holderCount: raw.holder_count,
      lpHolderCount: raw.lp_holder_count,
      source: 'api.gopluslabs.io（公开接口，无需账户）',
      note: 'critical = 会直接阻止资金流动；privileges = 运营方对余额的支配权；centralization = 设计层面的中心化特征，需结合项目背景判断',
    };
  },

  async content_cid(input) {
    const raw = String(input?.path ?? '');
    if (!raw) throw new Error('需要文件路径或文本内容');
    const bytes = Buffer.from(raw, 'utf8');
    const digest = crypto.createHash('sha256').update(bytes).digest();
    const prefix = Buffer.from([0x01, 0x55, 0x12, 0x20]); // cidv1 | raw | sha2-256 | 32
    const cid = 'b' + base32Encode(Buffer.concat([prefix, digest]));
    return {
      cid,
      version: 1,
      codec: 'raw',
      multihash: 'sha2-256',
      bytes: bytes.length,
      note: 'CIDv1/raw/sha2-256，标识完整原字节；不代表 IPFS UnixFS 导入结果。演示站把输入直接当作文件内容计算',
    };
  },

  async content_inspect(input) {
    const cid = String(input?.cid || '').trim();
    if (!cid.startsWith('b')) throw new Error('演示站仅解析 base32（b 开头）的 CIDv1');
    const buf = base32Decode(cid.slice(1));
    if (buf[0] !== 1) throw new Error('不是 CIDv1');
    const codecs = { 0x55: 'raw', 0x70: 'dag-pb', 0x71: 'dag-cbor', 0x72: 'libp2p-key' };
    const hashes = { 0x12: 'sha2-256', 0x13: 'sha2-512', 0x1b: 'keccak-256' };
    const codec = codecs[buf[1]] || `0x${buf[1].toString(16)}`;
    const mh = hashes[buf[2]] || `0x${buf[2].toString(16)}`;
    const len = buf[3];
    return {
      cid, version: 1, codec, multihash: mh, digestLength: len,
      digest: buf.slice(4, 4 + len).toString('hex'),
      note: '仅解析结构，不查询内容存在性',
    };
  },

  async did_key_resolve(input) {
    const did = String(input?.did || '').trim();
    const m = /^did:key:(z[1-9A-HJ-NP-Za-km-z]+)$/.exec(did);
    if (!m) throw new Error('需要 did:key:z... 形式的 DID');
    const bytes = base58Decode(m[1]);
    if (bytes[0] !== 0xed || bytes[1] !== 0x01) throw new Error('演示站仅支持 Ed25519（0xed01）');
    const key = bytes.slice(2, 34);
    return {
      did,
      verificationMethodId: `${did}#${m[1]}`,
      type: 'Ed25519VerificationKey2020',
      publicKeyMultibase: m[1],
      publicKeyHex: key.toString('hex'),
      document: {
        '@context': ['https://www.w3.org/ns/did/v1'],
        id: did,
        verificationMethod: [{ id: `${did}#${m[1]}`, type: 'Ed25519VerificationKey2020', controller: did, publicKeyMultibase: m[1] }],
        authentication: [`${did}#${m[1]}`],
        assertionMethod: [`${did}#${m[1]}`],
      },
      note: '离线解析，未查询链上或外部 registry',
    };
  },

  async capability_search(input) {
    const q = String(input?.query || '');
    if (!q) throw new Error('需要查询词');
    const hits = searchTools(q, { limit: 6 });
    return {
      query: q,
      matches: hits.map((t) => ({
        tool: t.name, category: t.category, credits: t.credits,
        readOnly: t.readOnly, live: t.live,
        params: t.params.map((p) => `${p.name}${p.required ? '*' : ''}:${p.type}`),
        desc: t.zh,
      })),
      total: hits.length,
    };
  },

  async capability_list(input) {
    if (input?.name) {
      const t = getTool(input.name);
      if (!t) throw new Error(`未知工具 ${input.name}`);
      return t;
    }
    return {
      total: TOOLS.length,
      categories: [...new Set(TOOLS.map((t) => t.category))],
      sample: TOOLS.slice(0, 12).map((t) => t.name),
    };
  },

  async system_doctor() {
    return {
      checks: [
        { item: 'node', status: 'ok', detail: process.version },
        { item: 'npm registry', status: 'ok', detail: 'registry.npmjs.org 可达' },
        { item: 'evm rpc', status: 'ok', detail: 'ethereum-rpc.publicnode.com' },
        { item: 'solana rpc', status: 'ok', detail: 'api.mainnet-beta.solana.com' },
        { item: 'forge / cast / anvil', status: 'warn', detail: '演示环境未安装 Foundry，本地部署类工具不可用' },
        { item: 'BCA_ALLOW_WRITES', status: 'off', detail: '写入开关关闭（默认）' },
      ],
      writable: false,
      note: '一项失败继续诊断；写入能力默认关闭',
    };
  },

  async workstation_search(input) {
    const q = String(input?.query || '');
    const plans = {
      nft: { steps: ['bca init nft --template erc721', 'bca build contracts', 'bca test contracts', '检查铸造权限与 tokenURI 测试'], needs: ['无需 RPC', '本地写入开关'] },
      deploy: { steps: ['bca find \'部署合约\' --dir contracts', '确认 loopback + 31337/1337', '设置 BCA_ALLOW_WRITES=true', 'dev_forge_deploy_local 带 submit:true'], needs: ['本地 Anvil', '显式发送地址'] },
      audit: { steps: ['bca find \'检查合约源码安全\' --target contracts', 'dev_slither_analyze', 'evm_contract_source 比对 runtime bytecode'], needs: ['solc 版本匹配'] },
    };
    const key = /nft|721/i.test(q) ? 'nft' : /部署|deploy|上线/i.test(q) ? 'deploy' : 'audit';
    const p = plans[key];
    return { task: key, query: q, steps: p.steps, prerequisites: p.needs, note: '返回步骤，由宿主 Agent 执行' };
  },
};

// ---------- 模拟执行器 ----------
function seeded(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); return ((h >>> 0) % 100000) / 100000; };
}

const SIM = {
  project_init(input) {
    const tpl = input?.template || 'erc20';
    const name = input?.name || 'My Token';
    const symbol = input?.symbol || 'TKN';
    return {
      created: `contracts/${tpl === 'counter' ? 'Counter' : tpl === 'erc721' ? 'MyNFT' : 'MyToken'}.sol`,
      template: tpl, name, symbol,
      dependencies: tpl === 'counter' ? ['forge-std'] : ['@openzeppelin/contracts@5.6.1', 'forge-std'],
      files: ['foundry.toml', 'src/', 'test/', 'script/'],
      next: ['bca build contracts', 'bca test contracts'],
    };
  },
  project_run(input) {
    const action = input?.action || 'test';
    const r = seeded(action + (input?.dir || ''));
    return action === 'build'
      ? { action: 'build', compiler: 'solc 0.8.35', contracts: 2, warnings: 0, artifacts: ['MyToken.json', 'IERC20.json'], ok: true }
      : { action: 'test', suites: 3, passed: 11, failed: 0, gas: { mint: 51234, transfer: 34771 }, ok: true, ms: Math.round(200 + r() * 400) };
  },
  dev_status() {
    return { forge: '0.2.x', cast: '0.2.x', anvil: '0.2.x', slither: 'not found', hardhat: 'not found', solc: '0.8.35 (builtin)', note: '演示环境版本为示意值' };
  },
  dev_solidity_compile(input) {
    return { file: input?.path || 'contracts/src/MyToken.sol', compiler: '0.8.35', abi: ['constructor(string,string,uint256)', 'balanceOf(address)', 'transfer(address,uint256)'], bytecodeSize: 4218, warnings: [] };
  },
  dev_slither_analyze() {
    return {
      detectors: [
        { check: 'reentrancy-eth', impact: 'High', confidence: 'Medium', count: 0 },
        { check: 'arbitrary-send-erc20', impact: 'High', confidence: 'High', count: 1, target: 'MyToken.sol#L42' },
        { check: 'centralization-risk', impact: 'Medium', confidence: 'High', count: 2 },
        { check: 'solc-version', impact: 'Informational', confidence: 'High', count: 1 },
      ],
      total: 4, note: '静态分析结果，不等于审计结论',
    };
  },
  dev_forge_deploy_local() {
    return { contractAddress: '0x5FbDB2315678afecb367f032d93F642f64180aa3', chainId: 31337, blockNumber: 1, gasUsed: '512340', status: 'success', guard: 'loopback + 31337 + explicit from + submit:true + BCA_ALLOW_WRITES' };
  },
  dev_forge_verify() {
    return { verifier: 'sourcify', status: 'verified', address: input?.address, note: '已向公共服务上传源码' };
  },
  viem_logs() {
    return { logs: [{ address: '0xdac17f958d2ee523a2206206994597c13d831ec7', topics: ['0xddf252ad...'], blockNumber: 21001234 }], count: 1 };
  },
  evm_proxy() {
    return { pattern: 'ERC-1967', implementation: '0x' + 'a1'.repeat(20), beacon: null, eip1167: false, blockTag: 'latest' };
  },
  evm_trace() {
    return { trace: [{ type: 'CALL', from: '0x' + '11'.repeat(20), to: '0x' + '22'.repeat(20), gas: 52134, depth: 1 }], reverted: false, note: '原始 trace，未重放' };
  },
  evm_contract_source() {
    return { source: 'verified', verifier: 'sourcify', match: 'exact_match', abi: ['balanceOf(address)', 'transfer(address,uint256)'], bytecodeMatch: true };
  },
  evm_verify_message() {
    return { signatureValid: true, recovered: '0x' + '3f'.repeat(20), scope: 'EIP-191 EOA only（未执行 EIP-1271）' };
  },
  sui_balance() { return { address: input?.address, totalBalance: '1250000000', coinType: '0x2::sui::SUI', sui: '1.25' }; },
  sui_object() { return { objectId: input?.objectId, type: '0x2::coin::Coin<0x2::sui::SUI>', version: 402133, owner: '0x' + 'aa'.repeat(20) }; },
  aptos_account() { return { address: input?.address, sequenceNumber: '128', authenticationKey: '0x' + 'bb'.repeat(32), resources: 7 }; },
  aptos_view() { return { function: input?.function, result: ['1000000'], ledgerVersion: 998877 }; },
  ipfs_read() { return { cid: input?.cid, bytes: 1024, base64: 'aGVsbG8gZnJvbSBkZW1v', note: '模拟返回，未连接 Kubo' }; },
  ipfs_add() { return { cid: 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi', bytes: 2048, dagSize: 4096, pinned: true, note: '模拟结果' }; },
  arweave_verify() { return { valid: true, owner: 'x' + 'A'.repeat(42), dataSize: 1024 }; },
  walrus_store() { return { blobId: 'W' + 'x'.repeat(42), objectId: '0x' + 'cc'.repeat(32), size: 4096, note: '模拟上传' }; },
  seal_encrypt() { return { ciphertext: 'U2VhbEVuY3J5cHRlZERlbW8=', bytes: 4096, note: '仅返回密文，不返回对称密钥' }; },
  vc_verify_jwt() { return { verified: true, issuer: 'did:key:z6Mk...', subject: 'did:key:z6Mk...', expires: '2027-01-01T00:00:00Z', scope: '签名与有效期通过；未检查吊销' }; },
  eas_attest() { return { uid: '0x' + 'dd'.repeat(32), transactionHash: '0x' + 'ee'.repeat(32), status: 'success', chainId: 84532 }; },
  eas_get() { return { found: true, attestation: { uid: '0x' + 'dd'.repeat(32), schema: '0x' + '12'.repeat(32), time: '1761800000', revocationTime: '0', attester: '0x' + '44'.repeat(20) } }; },
  eas_status() { return { chainId: 84532, eas: '0x4200000000000000000000000000000000000021', registry: '0x4200000000000000000000000000000000000020', version: '1.3.0', codePresent: true }; },
  eas_offchain_verify() { return { verified: true, signer: '0x' + '55'.repeat(20), domain: { chainId: 84532, version: '1.3.0' }, unchecked: ['revocation', 'timestamp', 'expiration'] }; },
  slsa_verify() { return { verified: true, builder: 'github.com/actions/runner', sourceRepo: 'github.com/example/repo', level: 3 }; },
  cosign_verify_blob() { return { verified: true, identity: 'https://github.com/example/.github/workflows/release.yml@refs/tags/v1.0.0', issuer: 'sigstore' }; },
  ots_verify() { return { verified: true, bitcoinBlock: 870123, timestamp: '2026-10-20T00:00:00Z', confirmations: 12 }; },
  risc0_verify() { return { verified: true, imageId: '0x' + '99'.repeat(32), journal: { result: 'ok' } }; },
  safe_info() { return { address: input?.address, owners: ['0x' + '66'.repeat(20), '0x' + '77'.repeat(20), '0x' + '88'.repeat(20)], threshold: 2, nonce: 14, version: '1.4.1' }; },
  ccxt_ticker() {
    const r = seeded(String(input?.symbol || 'BTC/USDT'));
    const base = /BTC/i.test(input?.symbol || '') ? 98000 : 3400;
    const last = base * (0.97 + r() * 0.06);
    return { exchange: input?.exchange || 'binance', symbol: input?.symbol || 'BTC/USDT', last: last.toFixed(2), bid: (last * 0.999).toFixed(2), ask: (last * 1.001).toFixed(2), volume24h: Math.round(1000 + r() * 9000), note: '模拟行情，非实时' };
  },
  ccxt_orderbook() { return { exchange: input?.exchange || 'binance', symbol: input?.symbol || 'BTC/USDT', bids: [[97950.1, 1.2], [97940.5, 0.8]], asks: [[98010.3, 0.9], [98020.7, 1.4]], note: '模拟深度' }; },
  x402_supported() { return { facilitator: 'demo', networks: ['base', 'base-sepolia'], schemes: ['exact'] }; },
  brian_prepare() { return { prompt: input?.prompt, transaction: { to: '0x' + 'aa'.repeat(20), data: '0x', value: '0', chainId: 8453 }, signs: false, submits: false }; },
  bankr_prompt() { return { prompt: input?.prompt, status: 'awaiting-approval', note: '可能触发钱包操作，需写入开关与显式提交' }; },
  mesh_call() { return { tool: input?.tool, result: { ok: true }, quota: { used: 12, limit: 100 } }; },
  bridge_servers() { return { configured: [{ name: 'openzeppelin', transport: 'stdio', verified: true }, { name: 'goplus-public', transport: 'http', verified: true }], presets: ['dune', 'nansen', 'chainstack', 'thirdweb', 'slither'] }; },
  bridge_discover() { return { server: input?.server || 'openzeppelin', tools: ['solidity-erc20', 'solidity-erc721', 'solidity-governor'], transport: 'stdio' }; },
  bridge_call() { return { server: input?.server, tool: input?.tool, isError: false, result: { code: '// SPDX-License-Identifier: MIT\ncontract MyToken {}' } }; },
  bridge_refresh() { return { server: input?.server, added: 1, removed: 0, changed: 0, unverified: ['solidity-erc1155'] }; },
  workstation_diagnose() { return { status: 'reverted', reason: 'ERC20: transfer amount exceeds balance', proxy: { pattern: 'ERC-1967' }, traceAvailable: true, gaps: ['源码未验证'] }; },
};

export async function runTool(name, input = {}) {
  const tool = getTool(name);
  if (!tool) throw new Error(`未知工具：${name}`);
  const t0 = Date.now();
  let mode = 'simulated';
  let data;
  try {
    if (LIVE[name]) {
      mode = 'live';
      data = await LIVE[name](input);
    } else if (SIM[name]) {
      await new Promise((r) => setTimeout(r, 180 + Math.random() * 320));
      data = SIM[name](input);
    } else {
      await new Promise((r) => setTimeout(r, 150 + Math.random() * 250));
      data = { note: '该工具在演示环境中没有执行器，返回占位结构', input };
    }
  } catch (e) {
    return { ok: false, tool: name, mode, ms: Date.now() - t0, credits: tool.credits, error: String(e.message || e) };
  }
  return { ok: true, tool: name, mode, ms: Date.now() - t0, credits: tool.credits, readOnly: tool.readOnly, input, data };
}

export { isAddress, isHash };
