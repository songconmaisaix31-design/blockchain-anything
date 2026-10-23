import type { AuthKind, McpServerEntry } from './config.js';

/**
 * Only official endpoints/commands that were read from vendor documentation
 * and actually reached during verification are published here. No tool lists
 * are copied into presets: every caller discovers tools from the live server.
 */
export interface Preset {
  id: string;
  name: string;
  vendor: string;
  transport: 'stdio' | 'streamable-http';
  endpoint: string;
  auth: AuthKind;
  authHint: string;
  requires: string[];
  docs: string;
  config: McpServerEntry;
  notes: string[];
  variants?: Array<{ name: string; url?: string; command?: string; note: string }>;
}

const mcpRemote = (url: string): McpServerEntry => ({
  type: 'stdio',
  command: 'npx',
  args: ['-y', 'mcp-remote@0.15.2', url],
});

const oauthHint =
  '首次连接由官方 mcp-remote 客户端在浏览器完成 OAuth；Token 由 mcp-remote 保存在自己的缓存目录，本工具不读取、不打印 Token。';

export const PRESETS: Preset[] = [
  {
    id: 'coingecko',
    name: 'CoinGecko',
    vendor: 'CoinGecko',
    transport: 'streamable-http',
    endpoint: 'https://mcp.api.coingecko.com/mcp',
    auth: 'none',
    authHint: '无需凭证；共享速率限制。',
    requires: [],
    docs: 'https://docs.coingecko.com/ai-integration/mcp-server',
    config: { type: 'http', url: 'https://mcp.api.coingecko.com/mcp' },
    notes: [
      '官方免费 keyless Streamable HTTP 端点。',
      'Pro API key 端点 https://mcp.pro-api.coingecko.com/mcp 需 CoinGecko 付费 key；本地包 @coingecko/coingecko-mcp 也可用。',
    ],
    variants: [
      { name: 'pro', url: 'https://mcp.pro-api.coingecko.com/mcp', note: '需要 CoinGecko Pro API key；首次连接在浏览器输入 key。' },
      { name: 'local', command: 'npx -y @coingecko/coingecko-mcp', note: '本地官方 MCP 包，按 README 设置 COINGECKO_PRO_API_KEY 或 COINGECKO_DEMO_API_KEY。' },
    ],
  },
  {
    id: 'openzeppelin',
    name: 'OpenZeppelin Contracts',
    vendor: 'OpenZeppelin',
    transport: 'streamable-http',
    endpoint: 'https://mcp.openzeppelin.com/contracts/solidity/mcp',
    auth: 'none',
    authHint: '无需凭证；服务器返回合约源码。',
    requires: [],
    docs: 'https://mcp.openzeppelin.com',
    config: { type: 'http', url: 'https://mcp.openzeppelin.com/contracts/solidity/mcp' },
    notes: [
      '官方 hosted Streamable HTTP；默认 Solidity，其他语言见 variants。',
      '本地替代：npx -y @openzeppelin/contracts-mcp（官方 npm 包）。',
      '生成结果仍由调用者审查，不构成审计。',
    ],
    variants: [
      { name: 'cairo', url: 'https://mcp.openzeppelin.com/contracts/cairo/mcp', note: 'Cairo Contracts' },
      { name: 'confidential', url: 'https://mcp.openzeppelin.com/contracts/confidential/mcp', note: 'Confidential Contracts' },
      { name: 'stellar', url: 'https://mcp.openzeppelin.com/contracts/stellar/mcp', note: 'Stellar Contracts' },
      { name: 'stylus', url: 'https://mcp.openzeppelin.com/contracts/stylus/mcp', note: 'Stylus Contracts' },
      { name: 'tron', url: 'https://mcp.openzeppelin.com/contracts/tron/mcp', note: 'TRON Contracts' },
      { name: 'uniswap-hooks', url: 'https://mcp.openzeppelin.com/contracts/uniswap-hooks/mcp', note: 'Uniswap Hooks' },
      { name: 'sui', url: 'https://mcp.openzeppelin.com/contracts/sui/mcp', note: 'Sui Move Contracts' },
    ],
  },
  {
    id: 'slither',
    name: 'Slither MCP',
    vendor: 'Trail of Bits',
    transport: 'stdio',
    endpoint: 'uvx --from git+https://github.com/trailofbits/slither-mcp slither-mcp',
    auth: 'local',
    authHint: '本地进程，无需网络凭证。',
    requires: ['uv/uvx', 'Python 3.11+', 'Solidity 项目与 solc/Foundry 或 Hardhat'],
    docs: 'https://github.com/trailofbits/slither-mcp',
    config: {
      type: 'stdio',
      command: 'uvx',
      args: ['--from', 'git+https://github.com/trailofbits/slither-mcp', 'slither-mcp'],
      timeoutMs: 300_000,
    },
    notes: [
      'AGPL-3.0；作为本地进程通过 stdio 调用，不嵌入或再分发其代码。',
      '官方默认启用匿名工具调用遥测；如需关闭，在 args 末尾加 --disable-metrics（会写 ~/.slither-mcp/metrics_disabled）。',
      '所有工具接受项目 path；首次分析会在项目内生成 artifacts/project_facts.json。',
    ],
  },
  {
    id: 'tenderly',
    name: 'Tenderly MCP',
    vendor: 'Tenderly',
    transport: 'streamable-http',
    endpoint: 'https://mcp.tenderly.co/mcp',
    auth: 'oauth',
    authHint: `${oauthHint} 需要已开通 MCP Server 的 Tenderly 付费计划。`,
    requires: ['Tenderly 账户', '含 MCP Server 访问权的付费计划', '至少一个 Tenderly 项目'],
    docs: 'https://docs.tenderly.co/mcp-server',
    config: mcpRemote('https://mcp.tenderly.co/mcp'),
    notes: [
      '官方 OAuth 2.0（WorkOS）端点，Streamable HTTP。',
      '未开通 MCP 的计划即使 OAuth 成功也会返回 HTTP 403 / quota_limit_reached。',
      '官方文档列出 59 个工具；本桥接不硬编码工具目录。',
    ],
  },
  {
    id: 'goplus',
    name: 'GoPlus Security',
    vendor: 'GoPlus',
    transport: 'stdio',
    endpoint: 'npx -y goplus-mcp@1.0.1',
    auth: 'key-secret',
    authHint: '需要 GoPlus API key 与 secret，由操作者通过 GOPLUS_API_KEY / GOPLUS_API_SECRET 提供。',
    requires: ['GOPLUS_API_KEY', 'GOPLUS_API_SECRET'],
    docs: 'https://github.com/GoPlusSecurity/goplus-mcp',
    config: {
      type: 'stdio',
      command: 'npx',
      args: ['-y', 'goplus-mcp@1.0.1', '--key', '${GOPLUS_API_KEY}', '--secret', '${GOPLUS_API_SECRET}'],
    },
    notes: [
      '官方 npm stdio 服务器；凭证只放配置环境变量或进程环境，不作为工具输入。',
      '凭据申请见 https://gopluslabs.io/security-api。',
    ],
  },
  {
    id: 'alchemy',
    name: 'Alchemy MCP',
    vendor: 'Alchemy',
    transport: 'streamable-http',
    endpoint: 'https://mcp.alchemy.com/mcp',
    auth: 'oauth',
    authHint: oauthHint,
    requires: ['Alchemy 账户（官方端点使用 OAuth，无需 API key）'],
    docs: 'https://www.alchemy.com/docs/build-with-ai',
    config: mcpRemote('https://mcp.alchemy.com/mcp'),
    notes: [
      '官方 hosted Streamable HTTP，OAuth 登录，无需本地安装或 API key。',
      '官方说明约 159 个工具、100+ 网络；实际目录由 tools/list 动态发现。',
    ],
  },
  {
    id: 'thirdweb',
    name: 'thirdweb AI',
    vendor: 'thirdweb',
    transport: 'streamable-http',
    endpoint: 'https://api.thirdweb.com/mcp',
    auth: 'project-secret',
    authHint: '需要 thirdweb project secret key，通过 THIRDWEB_SECRET_KEY 注入 URL 查询参数。',
    requires: ['THIRDWEB_SECRET_KEY'],
    docs: 'https://portal.thirdweb.com/ai/mcp',
    config: {
      type: 'http',
      url: 'https://api.thirdweb.com/mcp?secretKey=${THIRDWEB_SECRET_KEY}',
    },
    notes: [
      'Nebula 已由 thirdweb AI 取代；旧 nebula.thirdweb.com 已于 2025-09-30 弃用，不使用旧入口。',
      '官方端点把 project secret key 放在查询参数；本桥接在状态和错误中隐藏查询串。',
      '工具含写入/交易能力，实际调用前按上游要求确认。',
    ],
  },
  {
    id: 'chainstack',
    name: 'Chainstack',
    vendor: 'Chainstack',
    transport: 'streamable-http',
    endpoint: 'https://mcp.chainstack.com/mcp',
    auth: 'none',
    authHint: '核心工具无需凭证；平台/节点工具需 Authorization: Bearer <Chainstack API key>。',
    requires: [],
    docs: 'https://docs.chainstack.com/docs/chainstack-mcp-server',
    config: { type: 'http', url: 'https://mcp.chainstack.com/mcp' },
    notes: [
      '官方 hosted Streamable HTTP；search_docs、get_platform_status 等核心工具无需 key。',
      '需要节点/项目/faucet 工具时在操作者配置的 headers 中加 Authorization: Bearer ${CHAINSTACK_API_KEY}。',
      '旧 chainstacklabs/rpc-nodes-mcp 仓库已弃用，不使用旧端点。',
    ],
  },
  {
    id: 'nansen',
    name: 'Nansen',
    vendor: 'Nansen',
    transport: 'streamable-http',
    endpoint: 'https://mcp.nansen.ai/ra/mcp',
    auth: 'api-key',
    authHint: '需要 Nansen API key，放在 NANSEN-API-KEY header；按 API credits 计费。',
    requires: ['NANSEN_API_KEY', 'Nansen API credits'],
    docs: 'https://docs.nansen.ai/mcp/connecting',
    config: {
      type: 'http',
      url: 'https://mcp.nansen.ai/ra/mcp',
      headers: { 'NANSEN-API-KEY': '${NANSEN_API_KEY}' },
    },
    notes: [
      '官方手动连接端点；连接器 OAuth 端点为 https://mcp.nansen.ai/ra/connector-curated/mcp（工具集较少）。',
      '只读；工具调用计入 Nansen API credits。',
    ],
  },
  {
    id: 'dune',
    name: 'Dune',
    vendor: 'Dune',
    transport: 'streamable-http',
    endpoint: 'https://api.dune.com/mcp/v1',
    auth: 'oauth',
    authHint: oauthHint,
    requires: ['Dune 账户'],
    docs: 'https://docs.dune.com/docs/agents/mcp',
    config: mcpRemote('https://api.dune.com/mcp/v1'),
    notes: [
      '官方 remote MCP，OAuth 2.0 + PKCE 或 API key 两种认证。',
      '长查询可能超过默认工具超时；本项目允许按 provider 配置 timeoutMs（最大 600000）。',
      'API key 变体见 dune-api-key。',
    ],
  },
  {
    id: 'dune-api-key',
    name: 'Dune (API key)',
    vendor: 'Dune',
    transport: 'streamable-http',
    endpoint: 'https://api.dune.com/mcp/v1',
    auth: 'api-key',
    authHint: '需要 Dune API key，放在 x-dune-api-key header。',
    requires: ['DUNE_API_KEY'],
    docs: 'https://docs.dune.com/docs/agents/mcp',
    config: {
      type: 'http',
      url: 'https://api.dune.com/mcp/v1',
      headers: { 'x-dune-api-key': '${DUNE_API_KEY}' },
    },
    notes: ['适用于无浏览器环境；优先使用 OAuth 变体 dune。'],
  },
  {
    id: 'allium',
    name: 'Allium',
    vendor: 'Allium',
    transport: 'streamable-http',
    endpoint: 'https://mcp.allium.so',
    auth: 'oauth',
    authHint: oauthHint,
    requires: ['Allium 账户'],
    docs: 'https://docs.allium.so/ai/mcp/overview',
    config: mcpRemote('https://mcp.allium.so'),
    notes: [
      '当前官方 URL 为 https://mcp.allium.so；旧 mcp-oauth.allium.so 将于 2026-10-31 停止工作，不使用。',
      '可用 toolsets 查询参数裁剪工具集；API key 变体见 allium-api-key。',
    ],
  },
  {
    id: 'allium-api-key',
    name: 'Allium (API key)',
    vendor: 'Allium',
    transport: 'streamable-http',
    endpoint: 'https://mcp.allium.so',
    auth: 'api-key',
    authHint: '需要 Allium API key，Authorization: Bearer <key>。',
    requires: ['ALLIUM_API_KEY'],
    docs: 'https://docs.allium.so/ai/mcp/overview',
    config: {
      type: 'http',
      url: 'https://mcp.allium.so',
      headers: { Authorization: 'Bearer ${ALLIUM_API_KEY}' },
    },
    notes: ['X-API-KEY 仍可用但已弃用；新配置使用 Authorization: Bearer。'],
  },
  {
    id: 'tokenterminal',
    name: 'Token Terminal',
    vendor: 'Token Terminal',
    transport: 'streamable-http',
    endpoint: 'https://mcp.tokenterminal.com/mcp',
    auth: 'oauth',
    authHint: `${oauthHint} 免费计划含有限使用的 research 工具。`,
    requires: ['Token Terminal 账户'],
    docs: 'https://tokenterminal.com/docs/mcp/introduction',
    config: mcpRemote('https://mcp.tokenterminal.com/mcp'),
    notes: [
      '官方 remote MCP，OAuth 2.1 + PKCE，Streamable HTTP。',
      '官方当前只暴露 research 工具；以实际 tools/list 为准。',
    ],
  },
  {
    id: 'messari',
    name: 'Messari',
    vendor: 'Messari',
    transport: 'streamable-http',
    endpoint: 'https://mcp.messari.io/mcp',
    auth: 'oauth',
    authHint: `${oauthHint} 浏览器 OAuth 页面要求输入 Messari API key。`,
    requires: ['Messari Enterprise 订阅', 'AI Toolkit / ai_toolkit_permission 权限', 'Messari API key'],
    docs: 'https://docs.messari.io/mcp-server/hosted',
    config: mcpRemote('https://mcp.messari.io/mcp'),
    notes: [
      '官方 hosted MCP，OAuth 2.0；首次连接在浏览器输入 API key。',
      'search_messari_documents 与 query_messari_datasets 各限制 30 请求/分钟。',
      '工具与数据权限取决于 API key 的订阅等级。',
    ],
  },
  {
    id: 'coinbase-wallet',
    name: 'Coinbase Wallet MCP',
    vendor: 'Coinbase',
    transport: 'streamable-http',
    endpoint: 'https://wallet-mcp.coinbase.com',
    auth: 'oauth',
    authHint: `${oauthHint} 首次连接需在 Coinbase Wallet App 中批准。`,
    requires: ['Coinbase Wallet（原 Base App）', 'Coinbase 账户'],
    docs: 'https://docs.cdp.coinbase.com/ai-agents/coinbase-for-agents/wallet-mcp',
    config: mcpRemote('https://wallet-mcp.coinbase.com'),
    notes: [
      '官方 Wallet MCP，OAuth；Base 的旧 base-mcp 仓库已归档、npm 包已弃用，不使用。',
      '读工具可直接调用；send/swap/sign/send_calls 等写入会要求用户在钱包中逐次批准。',
      '本轨道不执行转账、交易或签名测试。',
    ],
  },
];

export interface NonMcpProvider {
  id: string;
  name: string;
  vendor: string;
  status: 'api-only' | 'skill-only' | 'no-public-interface' | 'deprecated';
  reason: string;
  docs: string;
  replacement?: string;
}

/** Providers that must not be presented as working MCP presets. */
export const NON_MCP_PROVIDERS: NonMcpProvider[] = [
  {
    id: 'bankr',
    name: 'Bankr',
    vendor: 'Bankr',
    status: 'api-only',
    reason: '官方文档只提供 Agent API / Wallet API / OpenAPI；没有官方 MCP 端点。按分工由 W 轨道接入 API，本轨道不重复实现。',
    docs: 'https://docs.bankr.bot/agent-api/overview/',
  },
  {
    id: 'brian',
    name: 'Brian',
    vendor: 'BrianAI',
    status: 'api-only',
    reason: '维护中的 Brian 服务通过 REST API / @brian-ai/sdk 提供；官方 mcp-server-brian 是 2025-03 的本地 Bun 包装器，未发布 npm，需 BRIAN_API_KEY，不是当前 hosted MCP。按分工由 W 轨道接入 API。',
    docs: 'https://github.com/brian-knows/mcp-server-brian',
  },
  {
    id: 'heurist',
    name: 'Heurist Mesh',
    vendor: 'Heurist',
    status: 'skill-only',
    reason: '官方 Heurist Mesh Skill 通过 REST API / x402 调用，没有 MCP 端点；按分工由 D/W 轨道接入官方 Skill，本轨道不重复实现。',
    docs: 'https://github.com/heurist-network/heurist-mesh-skill',
  },
  {
    id: 'kaito',
    name: 'Kaito',
    vendor: 'Kaito',
    status: 'no-public-interface',
    reason: 'Kaito API 页面仅提供 Contact Sales；没有公开 API 文档、公开端点或官方 MCP。Pro 门户是 Web 产品，不能当作 API。未找到可实际调用的公开官方接口，标记为阻塞。',
    docs: 'https://www.pro.kaito.ai/kaito-api',
  },
  {
    id: 'base-mcp',
    name: 'base-mcp (legacy)',
    vendor: 'Coinbase',
    status: 'deprecated',
    reason: 'base/base-mcp 仓库已归档，npm base-mcp 已弃用；官方迁移到 Wallet MCP。',
    docs: 'https://github.com/base/base-mcp',
    replacement: 'coinbase-wallet',
  },
  {
    id: 'rpc-nodes-mcp',
    name: 'rpc-nodes-mcp (legacy)',
    vendor: 'Chainstack',
    status: 'deprecated',
    reason: 'chainstacklabs/rpc-nodes-mcp 仓库已弃用，官方迁移到 mcp.chainstack.com。',
    docs: 'https://github.com/chainstacklabs/rpc-nodes-mcp',
    replacement: 'chainstack',
  },
];

export function findPreset(id: string): Preset | undefined {
  return PRESETS.find((preset) => preset.id === id);
}

export function findNonMcp(id: string): NonMcpProvider | undefined {
  return NON_MCP_PROVIDERS.find((provider) => provider.id === id);
}
