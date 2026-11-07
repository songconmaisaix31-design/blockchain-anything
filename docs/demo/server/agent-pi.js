// 线上试用 Agent 的最小实现：用 pi 作为 agent loop，BCA 作为工具层。
// 只做三件事：把一句话交给 pi、把 pi 的事件流映射成可视化轨迹、返回最终回答。
import { spawn } from 'node:child_process';

const PI_ENTRY = process.env.PI_ENTRY
  || 'C:/Users/DW/AppData/Roaming/npm/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js';
const PROJECT_ROOT = process.env.BCA_PROJECT_ROOT || process.cwd();
const PROVIDER = process.env.PI_PROVIDER || 'stepfun';
const MODEL = process.env.PI_MODEL || 'step-3.5-flash';
const TIMEOUT_MS = Number(process.env.PI_TIMEOUT_MS || 180000);

const SYSTEM_PROMPT = [
  '你是 BCA（Blockchain Anything）的链上助手，运行在一个体验站里。',
  '可用工具来自 BCA MCP 服务（mcp__bca__*），覆盖链上查询、合约开发、安全检测、内容寻址、身份与存储。',
  '规则：',
  '1. 先调用 tool_search 检索 BCA 工具，query 用英文关键词（如 token security、balance、block、cid、did、project、ticker、doctor）。',
  '2. tool_search 返回工具后，立刻调用其中匹配的那个 mcp__bca__* 工具；只在确实无关时才换关键词重搜一次。',
  '3. 如果两次都没命中，改用 mcp__bca__capability_search（传完整中文问题），从它返回的候选里挑工具名，再 tool_search 那个名字并调用。',
  '4. 常见对应：价格/行情→ccxt_ticker（exchange 传 okx，binance 在部分地区返回 451）；链上喂价→chainlink_price；兑换/能换多少/报价→jupiter_quote（Solana）；协议规模/TVL→defillama_protocol；各链 TVL 排名→defillama_chains；合约 ABI/函数→explorer_abi；模拟交易/会不会失败→tx_simulate；NFT 持有/归属/元数据→nft_balance / nft_owner / nft_metadata；跨链费用/到账→across_quote；跨链消息状态→wormhole_tx_status；Solana 代币持仓→solana_tokens；子图查询→subgraph_query；环境/装好没→system_doctor；余额→balance；区块→block；CID/哈希→content_cid；DID→did_key_resolve。',
  '5. 不要用 bash/read 自己实现链上逻辑，也不要因为一次搜索没命中就放弃。',
  '6. 问 Solana 地址持有多少「某个代币」时，调 solana_tokens 必须带 mint 参数（如 USDC 用 EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v）；不带 mint 会遍历全部代币账户，遇到空投刷量的地址要几十秒。只有问「有哪些代币」时才省略 mint。',
  '7. 只调用确实需要的工具，通常一到两个就够。',
  '8. 回答用中文，两到四句话，先给结论再给关键数据；不要输出工具调用过程。',
  '9. 不要伪造数据。工具失败就直说失败原因。',
  '10. 现场发行类任务（发币 / 发 NFT）只用 mcp__bca-sandbox__* 的工具，直接调用，不需要 tool_search。绝对不要调用 mcp__bca__project_* 或 mcp__bca__dev_forge_*（那是主网工作目录，会报路径不存在）。链是本地 Anvil（chainId 31337），from 固定 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266，写操作必须 submit=true。',
  '11. 发行固定三步，严格照做，不要探索环境：① mcp__bca-sandbox__project_init 参数 {template:"erc20" 或 "erc721", dir:"<符号小写>-demo", name, symbol, supply, submit:true}；② mcp__bca-sandbox__project_run 参数 {dir:同一个, action:"compile"}；③ mcp__bca-sandbox__dev_forge_deploy_local 参数 {dir:同一个, contract:"src/MyToken.sol:MyToken"（NFT 用 "src/MyNFT.sol:MyNFT"), constructorArgs:[], from:"0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", submit:true}。若 project_init 报目录已存在，把 dir 换成 <符号>-demo2 再走一遍。部署时 dir 参数不能省略，否则会去错误目录找合约。NFT 默认只铸 1 枚，除非用户明确要求多枚。',
  '12. 发行完成后要明确说明：这是本地沙盒链上的真实交易与合约地址，不消耗真钱、不影响主网；并把合约地址原样给出。不要把它说成主网资产。',
  '13. 白帽救援与复盘（全部只读）：查协议是否授权白帽救援 → safeharbor_registry（protocol 传协议地址，例如 Aave 是 0x5300A1a15135EA4dc7aD5a167152C01EFc9b192A；问「链上哪些协议登记了」就传 list:true 并说明扫描范围）；一笔交易到底做了什么 → tx_call_tree（transactionHash）；价差/套利/赚不赚 → arb_scan（必须把扣掉两腿手续费与 gas 后的净额讲出来，为负就直说「不成立」，不要推荐去做）；在 fork 上重放一笔交易 → fork_replay（要 30~60 秒，先说明正在重放）；待处理交易/内存池 → mempool_watch。',
  '14. 自身安全：我的无限授权/授权检查 → approval_scan（owner 传地址）；某个授权还能动多少 → allowance_check；NFT 集合授权 → nft_approval_check；这个合约能不能被升级/owner 是谁 → contract_posture；钱包体检 → wallet_posture。回答里必须说明覆盖边界：「没扫到的部分不等于没有」——授权扫描受区块窗口与 operator 清单限制。',
  '15. 不要声称工具能自动赚钱、能抢跑、能替用户交易。这些工具只做查询、解释与本地模拟；救援或套利的具体交易必须由人决定并自行签名。',
  '16. explorer_abi 需要 Etherscan key，本环境没配，调用会失败——失败一次就停止，不要为了解码反复重试；tx_call_tree 的返回值已经给出了可读结论。任何工具同一个调用最多试两次。',
  '17. 引用工具返回的数字时照抄，不要自己推算或改写（例如链的条数用返回里的 chainCount，赏金用 bountySummary），交易方向看 tx_call_tree 返回的 headline 与 from/to。工具没给的数字就说没给。',
  '18. 不要给地址贴身份标签（是谁的地址、属于哪个名人/机构），除非工具明确返回了标签。没有标签就只说"该地址"。',
  '19. 白帽登记、交易复盘、套利价差、授权/钱包/合约体检这些只读工具，一律用 mcp__bca__（主网 Ethereum）上的同名工具；不要用 mcp__bca-sandbox__ 去跑这类查询。沙盒只用于发币发 NFT。',
].join('\n');

function prettyTool(name) {
  if (name.startsWith('mcp__bca__')) return 'bca.' + name.slice('mcp__bca__'.length);
  return name;
}

function textOf(result) {
  if (!result) return '';
  if (Array.isArray(result.content)) {
    return result.content.filter((c) => c && c.type === 'text').map((c) => c.text).join('\n');
  }
  return typeof result === 'string' ? result : JSON.stringify(result);
}

export async function runAgentPi(query) {
  const q = String(query || '').trim();
  if (!q) throw new Error('请先输入一句任务描述');
  const t0 = Date.now();

  const args = [
    PI_ENTRY, '-p', '--approve', '--mode', 'json',
    '--provider', PROVIDER, '--model', MODEL,
    '--no-session', '--thinking', 'low',
    // 演示只需要 MCP 工具；去掉通用的文件/命令工具，避免 agent 在台上 ls/cat 乱试
    '--exclude-tools', 'bash,edit,write,read,glob,grep,todo_write',
    '--append-system-prompt', SYSTEM_PROMPT,
    '--', q,
  ];

  const child = spawn(process.execPath, args, {
    cwd: PROJECT_ROOT,
    // stdin 必须是 ignore，否则 pi 会等待 stdin 输入而不是执行
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env },
  });

  let buf = '';
  let stderr = '';
  const calls = [];          // { id, name, args, output }
  const pending = new Map();
  let answer = '';
  let usage = null;
  let failure = null;

  child.stdout.on('data', (chunk) => {
    buf += chunk.toString('utf8');
    let i;
    while ((i = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line || line[0] !== '{') continue;
      let ev;
      try { ev = JSON.parse(line); } catch { continue; }

      if (ev.type === 'tool_execution_start') {
        const rec = { id: ev.toolCallId, name: ev.toolName, args: ev.args || {}, output: '' };
        calls.push(rec);
        pending.set(ev.toolCallId, rec);
      } else if (ev.type === 'tool_execution_end') {
        const rec = pending.get(ev.toolCallId);
        if (rec) rec.output = textOf(ev.result);
      } else if (ev.type === 'message_end' && ev.message?.role === 'assistant') {
        const text = (ev.message.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim();
        if (text) answer = text;
        if (ev.message.usage) usage = ev.message.usage;
      } else if (ev.type === 'error' || ev.type === 'agent_error') {
        failure = ev.message || ev.error || 'pi 执行异常';
      }
    }
  });
  child.stderr.on('data', (d) => { stderr += d.toString('utf8'); });

  const timer = setTimeout(() => { failure = `模型响应超过 ${Math.round(TIMEOUT_MS / 1000)} 秒`; child.kill(); }, TIMEOUT_MS);
  const exitCode = await new Promise((resolve) => {
    child.on('close', resolve);
    child.on('error', (e) => { failure = `无法启动 pi：${e.message}`; resolve(-1); });
  });
  clearTimeout(timer);

  // 事件流映射成体验站的执行轨迹
  const steps = [{ step: 'parse', label: '理解任务', detail: q }];
  for (const c of calls) {
    if (c.name === 'tool_search') {
      steps.push({ step: 'find', label: '检索能力', detail: `在 BCA 工具目录里搜索「${c.args.query || ''}」` });
    } else if (/^mcp__[a-z0-9_-]+__/.test(c.name)) {
      const preview = c.output.replace(/\s+/g, ' ').slice(0, 160);
      steps.push({ step: 'call', label: '调用工具', detail: `${prettyTool(c.name)}(${JSON.stringify(c.args)})` });
      steps.push({ step: 'result', label: c.output.includes('"error"') || /失败|error/i.test(c.output.slice(0, 40)) ? '调用返回' : '调用成功', detail: preview });
    } else {
      steps.push({ step: 'aux', label: '辅助工具', detail: `${c.name}(${JSON.stringify(c.args).slice(0, 90)})` });
    }
  }
  steps.push({ step: 'answer', label: '回答', detail: answer || '模型没有返回文本' });

  const bcaCalls = calls.filter((c) => /^mcp__[a-z0-9_-]+__/.test(c.name));
  const ok = !failure && exitCode === 0 && !!answer;
  return {
    query: q,
    tool: bcaCalls.length ? prettyTool(bcaCalls[bcaCalls.length - 1].name) : 'pi',
    tools: bcaCalls.map((c) => prettyTool(c.name)),
    credits: bcaCalls.length,
    mode: 'live',
    engine: `pi · ${PROVIDER}/${MODEL}`,
    ok,
    totalMs: Date.now() - t0,
    steps,
    answer: answer || (failure ? String(failure) : '模型没有返回文本'),
    error: ok ? null : String(failure || stderr.trim().slice(-400) || `pi 退出码 ${exitCode}`),
    usage: usage ? { input: usage.input, output: usage.output, total: usage.totalTokens } : null,
    alternatives: [],
  };
}
