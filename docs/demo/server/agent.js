// 试用 Agent：把一句自然语言拆成「理解 → 检索 → 选择 → 调用 → 回答」的可见轨迹。
import { searchTools, getTool } from './catalog.js';
import { runTool } from './executors.js';

const EVM_ADDR = /0x[0-9a-fA-F]{40}/;
const TX_HASH = /0x[0-9a-fA-F]{64}/;
const B58_ADDR = /[1-9A-HJ-NP-Za-km-z]{32,44}/;
const DID_KEY = /did:key:z[1-9A-HJ-NP-Za-km-z]+/;

const CHAINS = [
  [/\b(base|贝斯)\b/i, '8453'], [/\barbitrum|arb\b/i, '42161'], [/\boptimism|\bop\b/i, '10'],
  [/\bpolygon|matic\b/i, '137'], [/\bbsc|币安链\b/i, '56'], [/\beth|以太|mainnet|主网\b/i, '1'],
];

function detect(q) {
  const out = { address: null, txHash: null, solana: null, did: null, chainId: '1', symbol: null };
  const tx = TX_HASH.exec(q);
  if (tx) out.txHash = tx[0];
  const evm = EVM_ADDR.exec(q);
  if (evm) out.address = evm[0];
  const did = DID_KEY.exec(q);
  if (did) out.did = did[0];
  if (!evm && !tx) {
    const b58 = B58_ADDR.exec(q);
    if (b58 && /sol|solana|lamport/i.test(q)) out.solana = b58[0];
  }
  for (const [re, id] of CHAINS) if (re.test(q)) { out.chainId = id; break; }
  const sym = /\b(BTC|ETH|SOL|BNB|USDT|ARB|OP)\s*\/?\s*(USDT|USDC|USD)?\b/i.exec(q);
  if (sym && /价格|行情|多少|price|ticker/i.test(q)) out.symbol = `${sym[1].toUpperCase()}/USDT`;
  return out;
}

// 意图 → 工具
function route(q, d) {
  const has = (...ws) => ws.some((w) => new RegExp(w, 'i').test(q));

  if (d.did || has('did:key', 'DID 文档', '解析 did')) return 'did_key_resolve';
  if (has('cid', '哈希', '内容标识') && !d.address) return 'content_cid';
  if (has('安全', '风险', '貔貅', 'rug', '能不能买', '蜜罐') && d.address) return 'goplus_token_security';
  if (d.txHash || has('回执', '交易状态', 'receipt', '成功了吗', '失败')) return d.txHash ? 'evm_receipt' : 'workstation_diagnose';
  if (d.solana) return 'solana_balance';
  if (d.address && has('余额', 'balance', '多少钱', '有几个')) return 'evm_balance';
  if (has('区块', 'block', '高度', 'gas')) return has('trace', '内部') ? 'evm_trace' : 'viem_block';
  if (has('链 ?id', 'chainid', '哪条链', '当前链', '网络信息')) return 'evm_chain';
  if (has('创建', '初始化', '脚手架', '新建') && has('合约', 'erc20', 'erc721', 'nft', '代币')) return 'project_init';
  if (has('编译', '测试', 'build', 'test')) return 'project_run';
  if (has('审计', '漏洞', 'slither', '静态分析', '安全吗.*合约')) return 'dev_slither_analyze';
  if (has('价格', '行情', '多少钱一个', 'price', 'ticker')) return 'ccxt_ticker';
  if (has('部署', 'deploy')) return 'dev_forge_deploy_local';
  if (has('诊断', '环境', 'doctor', '装好', '配置正确')) return 'system_doctor';
  if (has('代理', 'proxy', '可升级')) return 'evm_proxy';
  if (has('多签', 'safe')) return 'safe_info';
  return 'capability_search';
}

function buildInput(toolName, q, d) {
  switch (toolName) {
    case 'evm_balance': case 'viem_balance': case 'dev_cast_balance': return { address: d.address };
    case 'goplus_token_security': return { chainId: d.chainId, address: d.address };
    case 'solana_balance': return { address: d.solana };
    case 'evm_receipt': return { transactionHash: d.txHash };
    case 'workstation_diagnose': return { hash: d.txHash || undefined };
    case 'content_cid': {
      const f = /([\w.-]+\.[A-Za-z0-9]{1,6})\b/.exec(q);
      return { path: f ? f[1] : q };
    }
    case 'did_key_resolve': return { did: d.did };
    case 'viem_block': {
      const n = /\b(\d{4,9})\b/.exec(q);
      return n ? { blockNumber: n[1] } : {};
    }
    case 'ccxt_ticker': return { symbol: d.symbol || 'BTC/USDT' };
    case 'project_init': {
      const tpl = /721|nft/i.test(q) ? 'erc721' : /20|代币|token/i.test(q) ? 'erc20' : 'counter';
      const nm = /(?:叫|名为|名称[:：]?)\s*['"“]?([A-Za-z][\w ]{1,20})/i.exec(q);
      return { template: tpl, name: nm ? nm[1].trim() : undefined };
    }
    case 'project_run': return { action: /编译|build/i.test(q) ? 'build' : 'test' };
    case 'capability_search': case 'workstation_search': return { query: q };
    default: return d.address ? { address: d.address } : {};
  }
}

const VERDICT_ZH = { high: '高风险', medium: '中等风险', low: '轻微风险', clear: '未发现明显风险' };

function answer(toolName, data, d) {
  if (!data) return '调用没有返回数据。';
  switch (toolName) {
    case 'evm_balance': case 'viem_balance': case 'dev_cast_balance':
      return `${data.address} 的余额是 **${data.balanceEth} ETH**（${data.balanceWei} wei）。数据来自 ${data.rpc}。`;
    case 'solana_balance':
      return `${data.address} 持有 **${data.sol} SOL**（${data.lamports} lamports）。`;
    case 'evm_chain':
      return `当前连接的是 **${data.chain}**（chainId ${data.chainId}），最新区块 **#${data.latestBlock}**，RPC 出口 ${data.rpc}。`;
    case 'viem_block':
      return `区块 **#${data.number}**，产生于 ${data.time}，包含 ${data.transactions} 笔交易，gasUsed ${data.gasUsed} / ${data.gasLimit}。`;
    case 'evm_receipt':
      return data.found
        ? `交易在区块 #${data.blockNumber} 执行，状态 **${data.status}**，gasUsed ${data.gasUsed}，产生 ${data.logs} 条日志。`
        : `尚未查到这笔交易的回执。工具不推断交易成功与否，只报告 found=false。`;
    case 'goplus_token_security': {
      const t = data.token || {};
      const head = `**${t.symbol || '代币'}**（${t.name || ''}）判定为 **${VERDICT_ZH[data.verdict] || data.verdict}**。买入税 ${data.buyTax}、卖出税 ${data.sellTax}，持有人 ${data.holderCount}。`;
      const crit = data.critical?.length
        ? `\n\n会直接阻止资金流动的问题 ${data.critical.length} 项：${data.critical.join('、')}。`
        : '\n\n没有蜜罐、无法卖出、自毁这类会直接卡住你的问题。';
      const priv = data.privileges?.length ? `\n\n运营方特权 ${data.privileges.length} 项：${data.privileges.join('、')}——这意味着余额不由代码单方面决定。` : '';
      const cent = data.centralization?.length
        ? `\n\n中心化特征 ${data.centralization.length} 项：${data.centralization.join('、')}。这类特征不等于漏洞，取决于你是否信任该项目方。`
        : '';
      return head + crit + priv + cent;
    }
    case 'content_cid':
      return `算出的 CID 是 \`${data.cid}\`（CIDv1 / raw / sha2-256，${data.bytes} 字节）。这个 CID 标识完整原字节，不等于 IPFS UnixFS 导入结果。`;
    case 'content_inspect':
      return `这是一个 CIDv${data.version}，codec 为 ${data.codec}，multihash ${data.multihash}，digest 长度 ${data.digestLength}。仅解析结构，不查询内容是否存在。`;
    case 'did_key_resolve':
      return `解析成功：类型 ${data.type}，公钥 multibase \`${data.publicKeyMultibase.slice(0, 16)}…\`。这是离线解析，没有查询链上或外部 registry。`;
    case 'project_init':
      return `已按 **${data.template}** 模板创建项目，入口文件 ${data.created}，依赖 ${data.dependencies.join('、')}。下一步可以 \`bca build contracts\`。`;
    case 'project_run':
      return data.action === 'build'
        ? `编译通过：solc ${data.compiler}，产出 ${data.contracts} 个合约、${data.artifacts?.length || 0} 个 artifact，0 警告。`
        : `测试通过 ${data.passed} 个、失败 ${data.failed} 个。`;
    case 'dev_slither_analyze':
      return `Slither 报告 ${data.total} 个检测项，其中 High 影响 ${data.detectors.filter((x) => x.impact === 'High' && x.count > 0).length} 项。静态分析结果不等于审计结论。`;
    case 'capability_search': {
      if (!data.matches?.length) return `没有匹配到能力。可以换个说法，或者先 \`bca connect\` 接入一个供应商服务。`;
      const top = data.matches.slice(0, 3).map((m) => `\`${m.tool}\`（${m.credits} credit，${m.readOnly ? '只读' : '可写'}）`).join('、');
      return `找到 ${data.total} 个候选，最相关的是 ${top}。选一个我可以继续调用。`;
    }
    case 'ccxt_ticker':
      return `${data.exchange} 上 ${data.symbol} 最新价 **${data.last}**，买一 ${data.bid} / 卖一 ${data.ask}。注：演示环境返回模拟行情。`;
    case 'system_doctor': {
      const bad = data.checks.filter((c) => c.status !== 'ok');
      return `环境检查完成：${data.checks.length} 项中 ${data.checks.length - bad.length} 项正常${bad.length ? `，${bad.map((b) => `${b.item}（${b.detail}）`).join('、')} 需要处理` : ''}。写入能力当前${data.writable ? '开启' : '关闭'}。`;
    }
    case 'dev_forge_deploy_local':
      return `已部署到本地 Anvil：${data.contractAddress}，区块 #${data.blockNumber}，状态 ${data.status}。触发条件全部满足才允许执行：${data.guard}。`;
    case 'workstation_diagnose':
      return `诊断结果：${data.status}，原因 ${data.reason}。已收集代理信息与 trace，缺口：${data.gaps?.join('、') || '无'}。`;
    case 'safe_info':
      return `${data.address} 是多签钱包，${data.owners.length} 个所有者、阈值 ${data.threshold}、当前 nonce ${data.nonce}（v${data.version}）。`;
    default:
      return '调用完成，结果见下方原始返回。';
  }
}

export async function runAgent(query, session = {}) {
  const q = String(query || '').trim();
  if (!q) throw new Error('请先输入一句任务描述');
  const t0 = Date.now();
  const steps = [];
  const d = detect(q);

  steps.push({
    step: 'parse', label: '理解任务', ms: 90,
    detail: [
      d.address && `地址 ${d.address.slice(0, 10)}…`,
      d.txHash && `交易 ${d.txHash.slice(0, 10)}…`,
      d.solana && `Solana 地址 ${d.solana.slice(0, 8)}…`,
      d.did && `DID ${d.did.slice(0, 18)}…`,
      /eth|以太|mainnet|主网/i.test(q) && '链 Ethereum',
    ].filter(Boolean).join(' · ') || '未从描述中提取到地址或哈希，按能力检索处理',
  });

  const candidates = searchTools(q, { limit: 5 });
  steps.push({
    step: 'find', label: '检索能力', ms: 140,
    detail: candidates.length
      ? `命中 ${candidates.length} 个：${candidates.slice(0, 3).map((c) => c.name).join('、')}`
      : '内置目录没有直接命中',
  });

  let toolName = route(q, d);
  const chosen = getTool(toolName) || getTool('capability_search');
  toolName = chosen.name;
  const input = buildInput(toolName, q, d);

  steps.push({
    step: 'select', label: '选择工具', ms: 110,
    detail: `${toolName} · ${chosen.credits} credit · ${chosen.readOnly ? '只读' : '可写'} · ${chosen.live ? '真实执行' : '演示执行'}`,
  });

  const res = await runTool(toolName, input);

  steps.push({
    step: 'call', label: res.ok ? '调用成功' : '调用失败', ms: 160,
    detail: res.ok ? `${res.mode === 'live' ? '实时' : '演示'}数据 · ${res.ms}ms · 消耗 ${res.credits} credit` : res.error,
  });

  const text = res.ok ? answer(toolName, res.data, d) : `调用失败：${res.error}`;
  steps.push({ step: 'answer', label: '回答', ms: 80, detail: text });

  return {
    query: q,
    tool: toolName,
    credits: res.credits || 0,
    mode: res.mode,
    ok: res.ok,
    totalMs: Date.now() - t0,
    steps,
    answer: text,
    result: res,
    alternatives: candidates.filter((c) => c.name !== toolName).slice(0, 3).map((c) => ({ name: c.name, credits: c.credits, desc: c.zh })),
    session,
  };
}

export const SUGGESTIONS = [
  '查一下 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045 的余额',
  '以太坊现在第几个区块了',
  '这个代币安全吗 0xdAC17F958D2ee523a2206206994597C13D831ec7',
  '计算 README.md 的 CID',
  '创建一个 ERC20 合约并测试',
  '审计 contracts 目录有没有漏洞',
  'BTC 现在什么价格',
  '环境装好了吗，帮我诊断一下',
  'Aave 有没有登记白帽救援？条款是什么',
  '链上现在有哪些协议授权了白帽救援',
  '这笔交易到底做了什么 0xcdafd0d7825d6d4a4a2364534cf8f4f547a22038b0a484f0cfc21245892a2564',
  'WETH/USDC 两个池子现在有套利机会吗，扣完手续费还赚吗',
  '查一下我的地址有哪些无限授权 0xa8b347dd450eb7a159e48fb8725f7f5d03644fd6',
];
