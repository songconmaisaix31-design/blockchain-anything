// BCA 工具目录 —— 名称与描述取自 blockchain-anything 仓库 src/providers/*.ts 的 defineTool 定义。
// 用于演示站的能力检索（capability_search）与工具浏览。

export const CATEGORIES = {
  dev: { label: '合约开发', zh: '脚手架、编译、测试、静态分析' },
  chain: { label: '链上查询', zh: '余额、区块、交易、日志、代理、trace' },
  security: { label: '安全检测', zh: '代币风险、合约源码比对' },
  content: { label: '存储与内容', zh: 'CID、IPFS、Arweave、Walrus、Seal' },
  identity: { label: '身份与证明', zh: 'EAS、DID、VC、来源校验' },
  market: { label: '交易与行情', zh: 'CCXT 行情、订单簿、Agent 交易' },
  system: { label: '发现与诊断', zh: '能力检索、环境诊断、工作站' },
  bridge: { label: '外部服务', zh: '官方 MCP 服务的真实工具' },
};

const P = (name, type, required, desc) => ({ name, type, required, desc });

export const TOOLS = [
  // ---------- 发现与诊断 ----------
  {
    name: 'capability_search', provider: 'builtin', category: 'system', credits: 0, readOnly: true, live: true,
    zh: '按任务查找内置工具与官方供应商；指定服务后发现真实目录，返回缺项、Schema 入口及实际调用入口。',
    tags: ['查找', '发现', '搜索', '工具', 'find', 'search', '能力', '有什么'],
    params: [P('query', 'string', true, '自然语言任务描述，如「Solana 余额」'), P('server', 'string', false, '限定某个已配置的 MCP 服务')],
  },
  {
    name: 'capability_list', provider: 'builtin', category: 'system', credits: 0, readOnly: true, live: true,
    zh: '列出能力摘要和配置状态；指定 name 或 details=true 才返回完整 Schema 与来源。',
    tags: ['列表', '工具', 'list', 'schema', '清单'],
    params: [P('name', 'string', false, '工具名，用于查看完整 Schema'), P('details', 'boolean', false, '是否返回完整 Schema')],
  },
  {
    name: 'system_doctor', provider: 'builtin', category: 'system', credits: 0, readOnly: true, live: true,
    zh: '逐项检查安装、配置及明确选定的连接；一项失败继续诊断。',
    tags: ['诊断', '环境', 'doctor', '检查', '健康', '配置'],
    params: [],
  },
  {
    name: 'workstation_search', provider: 'builtin', category: 'system', credits: 0, readOnly: true, live: true,
    zh: '中英文问题检索；编译和测试不要求部署权限。返回步骤，由宿主执行。',
    tags: ['工作站', '步骤', '流程', '工作流', '怎么', '如何'],
    params: [P('query', 'string', true, '任务问题，中英文均可')],
  },
  {
    name: 'workstation_diagnose', provider: 'builtin', category: 'chain', credits: 20, readOnly: true, live: false,
    zh: 'EVM 交易诊断：查询状态、固定区块源码/代理/trace，返回证据和缺口；不签署、不自动重发。',
    tags: ['诊断', '交易失败', '为什么失败', 'trace', '回执', '排查', 'revert'],
    params: [P('hash', 'hash', true, '交易哈希'), P('artifact', 'string', false, '本地编译产物路径')],
  },

  // ---------- 合约开发 ----------
  {
    name: 'project_init', provider: 'Foundry', category: 'dev', credits: 0, readOnly: false, live: false,
    zh: '在新目录创建可编译测试的 Foundry 项目；ERC20/ERC721 复用 OpenZeppelin 5.6.1，不覆盖已有目录。',
    tags: ['创建', '初始化', '脚手架', 'init', 'erc20', 'erc721', 'nft', '代币', '合约', '新项目'],
    params: [P('template', 'enum', true, 'counter | erc20 | erc721'), P('name', 'string', false, '代币名称'), P('symbol', 'string', false, '代币符号')],
  },
  {
    name: 'project_run', provider: 'Foundry / Hardhat', category: 'dev', credits: 0, readOnly: true, live: false,
    zh: '识别已有 Foundry/Hardhat，执行编译或测试；保留原项目、原诊断和失败码。',
    tags: ['编译', '测试', 'build', 'test', 'forge', 'hardhat', '运行'],
    params: [P('action', 'enum', true, 'build | test'), P('dir', 'string', false, '项目目录')],
  },
  {
    name: 'dev_status', provider: 'local', category: 'dev', credits: 0, readOnly: true, live: false,
    zh: '检测本机 Forge/Cast/Anvil/Slither/Hardhat 与内置 solc 的实际可用版本；不安装、不联网。',
    tags: ['版本', '环境', 'forge', 'cast', 'anvil', 'slither', 'solc', '本机'],
    params: [],
  },
  {
    name: 'dev_solidity_compile', provider: 'solc', category: 'dev', credits: 0, readOnly: true, live: false,
    zh: '用本机安装的 solc JavaScript 编译器离线编译工作根目录内的 Solidity 文件，返回 ABI、字节码和官方诊断。',
    tags: ['编译', 'solidity', 'solc', 'abi', '字节码', '离线'],
    params: [P('path', 'string', true, 'Solidity 文件路径')],
  },
  {
    name: 'dev_slither_analyze', provider: 'Slither', category: 'security', credits: 5, readOnly: true, live: false,
    zh: '对工作根目录内的 Solidity 文件或目录运行真实 Slither，并返回官方 JSON 分析结果。',
    tags: ['安全', '审计', '漏洞', 'slither', '静态分析', '检查合约'],
    params: [P('target', 'string', true, '文件或目录')],
  },
  {
    name: 'dev_forge_deploy_local', provider: 'Foundry', category: 'dev', credits: 30, readOnly: false, live: false,
    zh: '通过官方 forge create 将已有合约部署到本机 Anvil；仅支持 loopback + 31337/1337、显式 unlocked from，确认回执及代码。',
    tags: ['部署', 'deploy', 'anvil', '本地', '合约', '上链'],
    params: [P('from', 'address', true, '发送地址'), P('submit', 'boolean', true, '必须显式为 true')],
  },
  {
    name: 'dev_forge_verify', provider: 'Foundry', category: 'security', credits: 5, readOnly: false, live: false,
    zh: '调用官方 forge verify-contract --verifier sourcify --watch；会向公共服务上传源码，不签署交易。',
    tags: ['验证', '源码', 'verify', 'sourcify', '公开'],
    params: [P('address', 'address', true, '合约地址')],
  },

  // ---------- 链上查询 ----------
  {
    name: 'evm_balance', provider: 'viem', category: 'chain', credits: 1, readOnly: true, live: true,
    zh: '查询 EVM 地址的原生币余额，金额为 wei 十进制字符串。',
    tags: ['余额', 'balance', 'evm', 'eth', '地址', '有多少钱', '查余额'],
    params: [P('address', 'address', true, '0x 开头的 40 位地址')],
  },
  {
    name: 'viem_balance', provider: 'viem', category: 'chain', credits: 1, readOnly: true, live: true,
    zh: '使用 viem 查询真实地址的原生币余额，返回 wei 十进制字符串。',
    tags: ['余额', 'balance', 'viem', 'wei', 'eth'],
    params: [P('address', 'address', true, '0x 地址')],
  },
  {
    name: 'dev_cast_balance', provider: 'Foundry Cast', category: 'chain', credits: 1, readOnly: true, live: true,
    zh: '通过配置的 RPC 读取真实地址的原生币余额，返回 wei 十进制字符串。',
    tags: ['余额', 'balance', 'cast', 'forge', 'rpc'],
    params: [P('address', 'address', true, '0x 地址')],
  },
  {
    name: 'evm_chain', provider: 'viem', category: 'chain', credits: 1, readOnly: true, live: true,
    zh: '连接配置的 EVM，核对 chain ID 并读取最新区块。',
    tags: ['链', 'chain', 'chainid', '区块', 'block', '网络', '主网'],
    params: [],
  },
  {
    name: 'viem_block', provider: 'viem', category: 'chain', credits: 1, readOnly: true, live: true,
    zh: '使用 viem 读取真实区块；不返回完整交易明细。',
    tags: ['区块', 'block', '高度', 'gas', '时间戳'],
    params: [P('blockNumber', 'string', false, '区块号，留空取最新')],
  },
  {
    name: 'evm_receipt', provider: 'viem', category: 'chain', credits: 1, readOnly: true, live: true,
    zh: '读取真实交易回执；尚未取得回执时返回 found=false，不推断交易成功。',
    tags: ['交易', '回执', 'receipt', 'hash', '状态', '成功了吗'],
    params: [P('transactionHash', 'hash', true, '交易哈希')],
  },
  {
    name: 'viem_logs', provider: 'viem', category: 'chain', credits: 3, readOnly: true, live: false,
    zh: '使用 viem 读取真实事件日志；范围必须由调用者明确给出。',
    tags: ['日志', '事件', 'logs', 'event', 'topic'],
    params: [P('address', 'address', false, '合约地址'), P('fromBlock', 'string', true, '起始区块')],
  },
  {
    name: 'evm_proxy', provider: 'viem', category: 'chain', credits: 2, readOnly: true, live: false,
    zh: '在固定区块检查 ERC-1967 implementation/beacon slot 与标准 ERC-1167 字节码。其他模式保持未知。',
    tags: ['代理', 'proxy', '1967', '1167', '实现地址', '升级'],
    params: [P('address', 'address', true, '合约地址')],
  },
  {
    name: 'evm_trace', provider: 'RPC', category: 'chain', credits: 20, readOnly: true, live: false,
    zh: '调用配置 RPC 的 debug_traceTransaction；返回原始执行 trace 与链/区块证据。未支持时明确失败，不自动重放。',
    tags: ['trace', '追踪', '执行', 'debug', '内部交易'],
    params: [P('hash', 'hash', true, '交易哈希')],
  },
  {
    name: 'evm_contract_source', provider: 'Sourcify', category: 'security', credits: 5, readOnly: true, live: false,
    zh: '读取本地编译结果或 Sourcify v2 源码/ABI；与固定区块链上 runtime bytecode 对照。',
    tags: ['源码', 'source', 'sourcify', 'abi', '比对', '字节码'],
    params: [P('address', 'address', true, '合约地址')],
  },
  {
    name: 'evm_verify_message', provider: 'viem', category: 'identity', credits: 1, readOnly: true, live: false,
    zh: '按 EIP-191 恢复 UTF-8 个人消息签名的 EOA 地址；仅验证 EOA 签名，不执行 EIP-1271。',
    tags: ['签名', '验证', 'signature', 'eip191', '恢复地址', '验签'],
    params: [P('message', 'string', true, '原始消息'), P('signature', 'string', true, '签名')],
  },
  {
    name: 'solana_balance', provider: 'Solana Kit', category: 'chain', credits: 1, readOnly: true, live: true,
    zh: '官方 Solana Kit 查询 lamports。',
    tags: ['solana', '余额', 'balance', 'lamports', 'sol', '查询'],
    params: [P('address', 'solana', true, 'Solana 地址（base58）')],
  },
  {
    name: 'sui_balance', provider: 'Sui gRPC', category: 'chain', credits: 1, readOnly: true, live: false,
    zh: '官方 Sui gRPC SDK 查询余额。',
    tags: ['sui', '余额', 'balance', '查询'],
    params: [P('address', 'string', true, 'Sui 地址')],
  },
  {
    name: 'sui_object', provider: 'Sui SDK', category: 'chain', credits: 1, readOnly: true, live: false,
    zh: '官方 Sui SDK 读取对象和内容。',
    tags: ['sui', '对象', 'object', '内容'],
    params: [P('objectId', 'string', true, '对象 ID')],
  },
  {
    name: 'aptos_account', provider: 'Aptos SDK', category: 'chain', credits: 1, readOnly: true, live: false,
    zh: '官方 Aptos SDK 查询账户与资源，最多 100 条。',
    tags: ['aptos', '账户', 'account', '资源'],
    params: [P('address', 'string', true, 'Aptos 地址')],
  },
  {
    name: 'aptos_view', provider: 'Aptos SDK', category: 'chain', credits: 1, readOnly: true, live: false,
    zh: '官方 Aptos SDK 调用只读 Move view，支持标量参数。',
    tags: ['aptos', 'move', 'view', '只读调用'],
    params: [P('function', 'string', true, 'Move view 函数')],
  },

  // ---------- 安全检测 ----------
  {
    name: 'goplus_token_security', provider: 'GoPlus 公开 API', category: 'security', credits: 3, readOnly: true, live: true,
    zh: '通过 GoPlus 公开 API 查询单个 EVM 代币的安全风险；无需账户，保留原始风险字段。',
    tags: ['安全', '风险', '代币', 'token', 'rug', '貔貅', 'goplus', '能不能买', '貔貅盘', '检查'],
    params: [P('chainId', 'string', true, '链 ID，如 1 = 以太坊'), P('address', 'address', true, 'ERC20 合约地址')],
  },

  // ---------- 存储与内容 ----------
  {
    name: 'content_cid', provider: 'multiformats', category: 'content', credits: 0, readOnly: true, live: true,
    zh: '读取工作根目录内的实际文件，返回 CIDv1/raw/sha2-256；此 CID 标识完整原字节，不代表 IPFS UnixFS 导入结果。',
    tags: ['cid', '计算', '哈希', 'ipfs', '内容', '文件', 'hash'],
    params: [P('path', 'string', true, '文件路径，演示站可直接输入文本内容')],
  },
  {
    name: 'content_inspect', provider: 'multiformats', category: 'content', credits: 0, readOnly: true, live: true,
    zh: '使用 multiformats 解析标准 CID，返回版本、codec 和 multihash；不查询内容存在性。',
    tags: ['cid', '解析', 'inspect', 'codec', 'multihash'],
    params: [P('cid', 'string', true, '标准 CID 字符串')],
  },
  {
    name: 'ipfs_read', provider: 'IPFS / Kubo', category: 'content', credits: 5, readOnly: true, live: false,
    zh: '从配置的 Kubo 读取 CID 内容，以 base64 返回；超过字节上限立即失败，不返回截断内容。',
    tags: ['ipfs', '读取', 'read', 'kubo', '内容'],
    params: [P('cid', 'string', true, 'CID')],
  },
  {
    name: 'ipfs_add', provider: 'IPFS / Kubo', category: 'content', credits: 10, readOnly: false, live: false,
    zh: '将工作根目录内的实际文件传输到配置的 Kubo 并固定保存；使用原生 UnixFS 导入，联网节点可能公开内容。',
    tags: ['ipfs', '上传', 'add', '固定', 'pin', '存储'],
    params: [P('path', 'string', true, '文件路径'), P('submit', 'boolean', true, '必须显式为 true')],
  },
  {
    name: 'arweave_verify', provider: 'arweave-js', category: 'content', credits: 3, readOnly: true, live: false,
    zh: '用官方 arweave-js 校验完整原生交易 JSON 的签名；无需钱包。',
    tags: ['arweave', '验证', '签名', 'verify'],
    params: [P('transaction', 'string', true, '原生交易 JSON')],
  },
  {
    name: 'walrus_store', provider: 'Walrus', category: 'content', credits: 10, readOnly: false, live: false,
    zh: '通过官方 publisher HTTP API 上传文件，保留原生 blobId/objectId；可能消耗配置服务的存储额度。',
    tags: ['walrus', '上传', 'blob', '存储', 'sui'],
    params: [P('path', 'string', true, '文件路径')],
  },
  {
    name: 'seal_encrypt', provider: 'Seal', category: 'content', credits: 5, readOnly: true, live: false,
    zh: '官方 Seal SDK 加密工作区文件；仅返回密文，不返回对称密钥。',
    tags: ['加密', 'seal', 'encrypt', '权限', '密文'],
    params: [P('path', 'string', true, '文件路径')],
  },

  // ---------- 身份与证明 ----------
  {
    name: 'did_key_resolve', provider: 'key-did-resolver', category: 'identity', credits: 0, readOnly: true, live: true,
    zh: '成熟 key-did-resolver 离线解析 did:key。',
    tags: ['did', '身份', '解析', 'key', 'did:key', '公钥'],
    params: [P('did', 'string', true, 'did:key:z... 形式的 DID')],
  },
  {
    name: 'vc_verify_jwt', provider: 'did-jwt-vc', category: 'identity', credits: 1, readOnly: true, live: false,
    zh: 'did-jwt-vc 校验 W3C VC-JWT 签名与有效期，支持 did:key；不代表签发者受信或吊销状态已检查。',
    tags: ['vc', '凭证', 'jwt', '验证', 'w3c', '可验证凭证'],
    params: [P('jwt', 'string', true, 'VC-JWT 字符串')],
  },
  {
    name: 'eas_attest', provider: 'EAS', category: 'identity', credits: 30, readOnly: false, live: false,
    zh: '发布公开 EAS 声明；data、recipient、refUID 等字段将上链，valueWei 与网络费用由签署账户支付。',
    tags: ['eas', '声明', '上链', 'attest', '证明'],
    params: [P('schema', 'string', true, 'Schema UID'), P('data', 'object', true, '编码后的数据'), P('submit', 'boolean', true, '必须显式为 true')],
  },
  {
    name: 'eas_get', provider: 'EAS', category: 'identity', credits: 1, readOnly: true, live: false,
    zh: '查询 EAS 链上声明原始字段，包括 expirationTime 和 revocationTime。',
    tags: ['eas', '查询', '声明', 'uid', '链上'],
    params: [P('uid', 'string', true, '声明 UID')],
  },
  {
    name: 'eas_status', provider: 'EAS', category: 'identity', credits: 1, readOnly: true, live: false,
    zh: '核对实际 chain ID、EAS/Registry 合约代码、关联地址和合约版本。',
    tags: ['eas', '状态', '配置', '版本', '合约'],
    params: [],
  },
  {
    name: 'eas_offchain_verify', provider: 'EAS', category: 'identity', credits: 1, readOnly: true, live: false,
    zh: '核对预期网络和 EAS domain/版本/签署者，并使用 SDK 验证 v2 UID 与签名；未检查撤销、时间戳、有效期和信任。',
    tags: ['eas', '链下', '验签', 'offchain', 'verify'],
    params: [P('attestation', 'object', true, '链下声明对象')],
  },
  {
    name: 'slsa_verify', provider: 'slsa-verifier', category: 'identity', credits: 3, readOnly: true, live: false,
    zh: '官方 slsa-verifier 检查构建产物、来源证明和预期源仓库。',
    tags: ['slsa', '供应链', '构建', '来源', '安全'],
    params: [P('artifact', 'string', true, '构建产物路径')],
  },
  {
    name: 'cosign_verify_blob', provider: 'Sigstore', category: 'identity', credits: 3, readOnly: true, live: false,
    zh: '官方 Cosign 根据显式公钥或证书身份验证 Sigstore bundle 与文件。',
    tags: ['cosign', 'sigstore', '签名', 'bundle', '验证'],
    params: [P('blob', 'string', true, '文件路径')],
  },
  {
    name: 'ots_verify', provider: 'OpenTimestamps', category: 'identity', credits: 2, readOnly: true, live: false,
    zh: '官方 OpenTimestamps 客户端验证文件和 .ots，保留原生验证报告。',
    tags: ['时间戳', 'ots', 'bitcoin', '证明', '存在性'],
    params: [P('file', 'string', true, '文件路径')],
  },
  {
    name: 'risc0_verify', provider: 'risc0', category: 'identity', credits: 5, readOnly: true, live: false,
    zh: '通过 viem 调用操作者配置的官方 IRiscZeroVerifier.verify；eth_call 验证 Groth16 seal，不提交交易。',
    tags: ['zk', '零知识', 'risc0', '证明', 'groth16'],
    params: [P('seal', 'string', true, 'Groth16 seal')],
  },
  {
    name: 'safe_info', provider: 'Safe', category: 'identity', credits: 1, readOnly: true, live: false,
    zh: '官方 Safe Protocol Kit 查询钱包所有者、阈值和 nonce。',
    tags: ['safe', '多签', '钱包', '所有者', '阈值', 'nonce'],
    params: [P('address', 'address', true, 'Safe 地址')],
  },

  // ---------- 交易与行情 ----------
  {
    name: 'ccxt_ticker', provider: 'CCXT', category: 'market', credits: 1, readOnly: true, live: false,
    zh: '通过官方 CCXT 查询公开行情，不加载交易凭据。',
    tags: ['行情', '价格', 'ticker', 'ccxt', '交易所', '多少钱'],
    params: [P('symbol', 'string', true, '交易对，如 BTC/USDT'), P('exchange', 'string', false, '交易所，默认 binance')],
  },
  {
    name: 'ccxt_orderbook', provider: 'CCXT', category: 'market', credits: 1, readOnly: true, live: false,
    zh: '通过官方 CCXT 查询公开订单簿。',
    tags: ['订单簿', 'orderbook', '买卖', '深度', 'ccxt'],
    params: [P('symbol', 'string', true, '交易对'), P('exchange', 'string', false, '交易所')],
  },
  {
    name: 'x402_supported', provider: 'x402', category: 'market', credits: 1, readOnly: true, live: false,
    zh: '官方 x402 facilitator client 查询支持的网络与支付方案。',
    tags: ['x402', '支付', 'facilitator', '网络', '方案'],
    params: [],
  },
  {
    name: 'brian_prepare', provider: 'Brian SDK', category: 'market', credits: 3, readOnly: true, live: false,
    zh: '官方 Brian SDK 将自然语言转换为待执行交易；不签署、不提交。',
    tags: ['自然语言', '交易', 'brian', '转换', 'swap'],
    params: [P('prompt', 'string', true, '自然语言描述')],
  },
  {
    name: 'bankr_prompt', provider: 'Bankr', category: 'market', credits: 5, readOnly: false, live: false,
    zh: '调用官方 Bankr Agent API；自然语言可能触发钱包操作，需写入开关和显式提交。',
    tags: ['agent', '交易', 'bankr', '自然语言'],
    params: [P('prompt', 'string', true, '自然语言指令'), P('submit', 'boolean', true, '必须显式为 true')],
  },
  {
    name: 'mesh_call', provider: 'Heurist Mesh', category: 'market', credits: 5, readOnly: true, live: false,
    zh: '调用 Heurist Mesh 原生工具，消耗已配置账户额度。',
    tags: ['mesh', 'heurist', '原生工具', '调用'],
    params: [P('tool', 'string', true, '原生工具名'), P('input', 'object', true, '工具参数')],
  },

  // ---------- 外部服务 ----------
  {
    name: 'bridge_servers', provider: 'MCP', category: 'bridge', credits: 0, readOnly: true, live: false,
    zh: '列出操作者配置的 MCP 服务（不返回值、Token 或命令行参数）及已核实的官方预设。',
    tags: ['mcp', '服务', '配置', '列表', 'servers'],
    params: [],
  },
  {
    name: 'bridge_discover', provider: 'MCP', category: 'bridge', credits: 0, readOnly: true, live: false,
    zh: '连接配置的 MCP 服务，执行真实初始化并读取 tools/list；保留上游完整 inputSchema、outputSchema、annotations 与分页游标。',
    tags: ['mcp', '发现', '目录', 'discover', 'tools'],
    params: [P('server', 'string', true, '服务名')],
  },
  {
    name: 'bridge_call', provider: 'MCP', category: 'bridge', credits: 5, readOnly: true, live: false,
    zh: '调用配置的 MCP 服务上的真实工具；上游 isError 时本次调用明确失败，并保留上游错误文本。',
    tags: ['mcp', '调用', 'bridge', '上游', '远程'],
    params: [P('server', 'string', true, '服务名'), P('tool', 'string', true, '工具名'), P('arguments', 'object', false, '参数')],
  },
  {
    name: 'bridge_refresh', provider: 'MCP', category: 'bridge', credits: 0, readOnly: true, live: false,
    zh: '刷新已配置官方 MCP 的完整 tools/list；记录 Schema/版本变化，新增工具保持未验证。',
    tags: ['mcp', '刷新', 'schema', '变更'],
    params: [P('server', 'string', true, '服务名')],
  },
  // ---------- 其余已定义工具：覆盖仓库全部 127 个 defineTool ----------
  {
    name: 'agent_actions', provider: 'AgentKit / Solana Agent Kit', category: 'market', credits: 4, readOnly: true, live: false,
    zh: '加载操作者创建的官方 AgentKit / Solana Agent Kit 实例，列出实际 actions 与 schema。',
    tags: ['agent', 'actions'],
    params: [],
  },
  {
    name: 'agent_call', provider: 'AgentKit / Solana Agent Kit', category: 'market', credits: 4, readOnly: true, live: false,
    zh: '执行官方 AgentKit / Solana Agent Kit 原生 action；可能签署或转账，默认要求写入开关和 submit=true。',
    tags: ['agent', 'call'],
    params: [],
  },
  {
    name: 'aptos_ledger', provider: 'Sui / Aptos / Sign Protocol', category: 'chain', credits: 2, readOnly: true, live: false,
    zh: '官方 Aptos SDK 查询账本信息。',
    tags: ['aptos', 'ledger'],
    params: [],
  },
  {
    name: 'arweave_info', provider: 'Arweave / Walrus', category: 'content', credits: 2, readOnly: true, live: false,
    zh: '官方 arweave-js 查询网关网络信息。',
    tags: ['arweave', 'info'],
    params: [],
  },
  {
    name: 'arweave_read', provider: 'Arweave / Walrus', category: 'content', credits: 2, readOnly: true, live: false,
    zh: '读取 Arweave 网关数据，严格执行响应大小上限。',
    tags: ['arweave', 'read'],
    params: [],
  },
  {
    name: 'arweave_transaction', provider: 'Arweave / Walrus', category: 'content', credits: 2, readOnly: true, live: false,
    zh: '官方 arweave-js 查询交易状态与元数据，不下载大文件。',
    tags: ['arweave', 'transaction'],
    params: [],
  },
  {
    name: 'bankr_job', provider: 'Heurist Mesh / Bankr', category: 'market', credits: 4, readOnly: true, live: false,
    zh: '查询 Bankr 已提交任务的状态。',
    tags: ['bankr', 'job'],
    params: [],
  },
  {
    name: 'bridge_close', provider: 'MCP 官方服务', category: 'bridge', credits: 2, readOnly: false, live: false,
    zh: '关闭本 toolkit 拥有的会话，不重放业务调用。',
    tags: ['bridge', 'close'],
    params: [],
  },
  {
    name: 'bridge_configure', provider: 'MCP 官方服务', category: 'bridge', credits: 0, readOnly: false, live: false,
    zh: '将官方 MCP 预设写入项目 .bca/mcp.json，保留原条目；下次发现读取真实上游工具。',
    tags: ['bridge', 'configure'],
    params: [],
  },
  {
    name: 'bridge_get_prompt', provider: 'MCP 官方服务', category: 'bridge', credits: 2, readOnly: true, live: false,
    zh: '读取官方 MCP prompt 内容，保留上游 messages。',
    tags: ['bridge', 'get', 'prompt'],
    params: [],
  },
  {
    name: 'bridge_open', provider: 'MCP 官方服务', category: 'bridge', credits: 2, readOnly: false, live: false,
    zh: '显式打开工作流会话；空闲 5 分钟过期，SDK 调用结束应 close。',
    tags: ['bridge', 'open'],
    params: [],
  },
  {
    name: 'bridge_prompts', provider: 'MCP 官方服务', category: 'bridge', credits: 2, readOnly: true, live: false,
    zh: '读取配置的 MCP 服务暴露的提示模板列表。',
    tags: ['bridge', 'prompts'],
    params: [],
  },
  {
    name: 'bridge_read_resource', provider: 'MCP 官方服务', category: 'bridge', credits: 2, readOnly: true, live: false,
    zh: '按 URI 读取配置的 MCP 服务的真实资源内容。',
    tags: ['bridge', 'read', 'resource'],
    params: [],
  },
  {
    name: 'bridge_resources', provider: 'MCP 官方服务', category: 'bridge', credits: 2, readOnly: true, live: false,
    zh: '读取配置的 MCP 服务的资源与资源模板列表；不支持资源时原样返回上游能力/空结果。',
    tags: ['bridge', 'resources'],
    params: [],
  },
  {
    name: 'c2pa_inspect', provider: 'C2PA / in-toto / OpenLineage / OTS', category: 'identity', credits: 3, readOnly: true, live: false,
    zh: '官方 c2patool 读取并验证媒体 manifest；返回完整原生 validation_status，不将命令成功等同于内容可信。',
    tags: ['c2pa', 'inspect'],
    params: [],
  },
  {
    name: 'ccxt_exchanges', provider: 'CCXT / Hummingbot', category: 'market', credits: 4, readOnly: true, live: false,
    zh: '列出已安装官方 CCXT 支持的交易所。',
    tags: ['ccxt', 'exchanges'],
    params: [],
  },
  {
    name: 'cheqd_did', provider: 'cheqd', category: 'identity', credits: 2, readOnly: true, live: false,
    zh: '通过官方 cheqd SDK 查询原生 DID 文档及版本元数据。',
    tags: ['cheqd', 'did'],
    params: [],
  },
  {
    name: 'dev_cast_block_number', provider: 'Foundry / Hardhat', category: 'dev', credits: 0, readOnly: true, live: false,
    zh: '通过配置的 RPC 读取真实最新区块号。',
    tags: ['dev', 'cast', 'block', 'number'],
    params: [],
  },
  {
    name: 'dev_cast_call', provider: 'Foundry / Hardhat', category: 'dev', credits: 0, readOnly: true, live: false,
    zh: '通过配置的 RPC 执行真实只读合约调用；返回 Cast 原始输出并尽量解析 JSON。',
    tags: ['dev', 'cast', 'call'],
    params: [],
  },
  {
    name: 'dev_cast_chain_id', provider: 'Foundry / Hardhat', category: 'dev', credits: 0, readOnly: true, live: false,
    zh: '通过配置的 RPC 读取真实 chain ID，并与 BCA_CHAIN_ID 核对。',
    tags: ['dev', 'cast', 'chain'],
    params: [],
  },
  {
    name: 'dev_erc721_mint_local', provider: 'Foundry / Anvil / Hardhat', category: 'dev', credits: 0, readOnly: false, live: false,
    zh: '在本机 Anvil 调用 ERC721 safeMint(address,uint256,string)，确认回执并读回 ownerOf/tokenURI；需要显式 unlocked from 和写入授权。',
    tags: ['dev', 'erc721', 'mint', 'local'],
    params: [],
  },
  {
    name: 'dev_forge_build', provider: 'Foundry / Hardhat', category: 'dev', credits: 0, readOnly: true, live: false,
    zh: '在指定项目目录运行真实 forge build --json；编译错误原样返回，不伪造成功。',
    tags: ['dev', 'forge', 'build'],
    params: [],
  },
  {
    name: 'dev_forge_test', provider: 'Foundry / Hardhat', category: 'dev', credits: 0, readOnly: true, live: false,
    zh: '在指定项目目录运行真实 forge test --json，返回测试套件结果；失败原样返回。',
    tags: ['dev', 'forge', 'test'],
    params: [],
  },
  {
    name: 'dev_hardhat_compile', provider: 'Foundry / Hardhat', category: 'dev', credits: 0, readOnly: true, live: false,
    zh: '在项目目录用其本地安装的 Hardhat CLI 执行 compile；不安装依赖、不替换编译器。',
    tags: ['dev', 'hardhat', 'compile'],
    params: [],
  },
  {
    name: 'dev_hardhat_test', provider: 'Foundry / Anvil / Hardhat', category: 'dev', credits: 0, readOnly: true, live: false,
    zh: '复用项目已安装 Hardhat 执行 test；可只运行一个测试文件。',
    tags: ['dev', 'hardhat', 'test'],
    params: [],
  },
  {
    name: 'dev_project', provider: 'Foundry / Anvil / Hardhat', category: 'dev', credits: 0, readOnly: true, live: false,
    zh: '读取现有 Foundry/Hardhat 配置、依赖与编译器要求，不执行项目配置。',
    tags: ['dev', 'project'],
    params: [],
  },
  {
    name: 'dev_skill_list', provider: 'Foundry / Hardhat', category: 'dev', credits: 0, readOnly: true, live: false,
    zh: '列出 BCA_SKILLS_ROOT（默认 ~/.agents/skills）下实际安装的 SKILL.md，不解析或改写技能内容。',
    tags: ['dev', 'skill', 'list'],
    params: [],
  },
  {
    name: 'dev_skill_read', provider: 'Foundry / Hardhat', category: 'dev', credits: 0, readOnly: true, live: false,
    zh: '读取 BCA_SKILLS_ROOT 下某个技能的实际 SKILL.md 内容。',
    tags: ['dev', 'skill', 'read'],
    params: [],
  },
  {
    name: 'eas_delegated_attest', provider: 'EAS', category: 'identity', credits: 3, readOnly: false, live: false,
    zh: '由中继账户提交预先签好的 EAS Delegated 声明；签名者与付费账户可以不同。',
    tags: ['eas', 'delegated', 'attest'],
    params: [],
  },
  {
    name: 'eas_delegated_revoke', provider: 'EAS', category: 'identity', credits: 3, readOnly: false, live: false,
    zh: '由中继账户提交预先签好的 EAS Delegated 撤销。',
    tags: ['eas', 'delegated', 'revoke'],
    params: [],
  },
  {
    name: 'eas_delegated_sign', provider: 'EAS', category: 'identity', credits: 3, readOnly: false, live: false,
    zh: '使用本地开发签署器生成 EAS 官方 Delegated EIP-712 签名；不广播交易。',
    tags: ['eas', 'delegated', 'sign'],
    params: [],
  },
  {
    name: 'eas_delegated_sign_revoke', provider: 'EAS', category: 'identity', credits: 3, readOnly: false, live: false,
    zh: '使用本地开发签署器生成 EAS 官方 Delegated 撤销签名；不广播交易。',
    tags: ['eas', 'delegated', 'sign', 'revoke'],
    params: [],
  },
  {
    name: 'eas_multi_attest', provider: 'EAS', category: 'identity', credits: 3, readOnly: false, live: false,
    zh: '在一次交易中向一个或多个 Schema 发布多条公开 EAS 声明；返回回执中的全部原生 UID。',
    tags: ['eas', 'multi', 'attest'],
    params: [],
  },
  {
    name: 'eas_multi_revoke', provider: 'EAS', category: 'identity', credits: 3, readOnly: false, live: false,
    zh: '在一次交易中批量撤销一个或多个 Schema 下的 EAS 声明。',
    tags: ['eas', 'multi', 'revoke'],
    params: [],
  },
  {
    name: 'eas_offchain_sign', provider: 'EAS', category: 'identity', credits: 3, readOnly: false, live: false,
    zh: '使用本地开发签署器生成 EAS v2 链下签名；domain 取自核验后的 chain/address/合约版本，不提交链上声明。',
    tags: ['eas', 'offchain', 'sign'],
    params: [],
  },
  {
    name: 'eas_private_data_build', provider: 'EAS', category: 'identity', credits: 3, readOnly: true, live: false,
    zh: '使用 EAS 官方 PrivateData 构造 Merkle 树并返回根；可选生成多值披露证明。',
    tags: ['eas', 'private', 'data', 'build'],
    params: [],
  },
  {
    name: 'eas_private_data_verify', provider: 'EAS', category: 'identity', credits: 3, readOnly: true, live: false,
    zh: '使用 EAS 官方 PrivateData 验证 Merkle 多值披露证明。',
    tags: ['eas', 'private', 'data', 'verify'],
    params: [],
  },
  {
    name: 'eas_private_data_verify_tree', provider: 'EAS', category: 'identity', credits: 3, readOnly: true, live: false,
    zh: '使用 EAS 官方 PrivateData 从完整树重算根，并与给定根比较。',
    tags: ['eas', 'private', 'data', 'verify'],
    params: [],
  },
  {
    name: 'eas_revoke', provider: 'EAS', category: 'identity', credits: 3, readOnly: false, live: false,
    zh: '由签署账户执行 EAS 链上撤销，撤销状态公开且需要网络费用。',
    tags: ['eas', 'revoke'],
    params: [],
  },
  {
    name: 'eas_schema_decode', provider: 'EAS', category: 'identity', credits: 3, readOnly: true, live: false,
    zh: '使用 EAS SchemaEncoder 解码 ABI 数据，保留官方字段结构。',
    tags: ['eas', 'schema', 'decode'],
    params: [],
  },
  {
    name: 'eas_schema_encode', provider: 'EAS', category: 'identity', credits: 3, readOnly: true, live: false,
    zh: '使用 EAS SchemaEncoder 编码 ABI 数据；大整数请使用十进制字符串。',
    tags: ['eas', 'schema', 'encode'],
    params: [],
  },
  {
    name: 'eas_schema_get', provider: 'EAS', category: 'identity', credits: 3, readOnly: true, live: false,
    zh: '从已核验的 SchemaRegistry 查询原生 Schema UID。',
    tags: ['eas', 'schema', 'get'],
    params: [],
  },
  {
    name: 'eas_schema_register', provider: 'EAS', category: 'identity', credits: 3, readOnly: false, live: false,
    zh: '向配置的 EAS SchemaRegistry 注册公开 Schema；交易需要支付网络费用。',
    tags: ['eas', 'schema', 'register'],
    params: [],
  },
  {
    name: 'eas_timestamp', provider: 'EAS', category: 'identity', credits: 3, readOnly: true, live: false,
    zh: '调用 EAS 官方合约对数据哈希做链上时间戳，返回回执中的时间戳。',
    tags: ['eas', 'timestamp'],
    params: [],
  },
  {
    name: 'evm_status', provider: 'builtin', category: 'chain', credits: 0, readOnly: true, live: false,
    zh: '读取各适配器的进程配置状态；不连接网络，不返回 RPC URL 或秘密。',
    tags: ['evm', 'status'],
    params: [],
  },
  {
    name: 'hummingbot_status', provider: 'CCXT / Hummingbot', category: 'market', credits: 4, readOnly: true, live: false,
    zh: '读取已部署 Hummingbot API 的运行中机器人状态；不启动策略、不下单。',
    tags: ['hummingbot', 'status'],
    params: [],
  },
  {
    name: 'intoto_verify', provider: 'C2PA / in-toto / OpenLineage / OTS', category: 'identity', credits: 3, readOnly: true, live: false,
    zh: '官方 in-toto 验证供应链 layout 和 links。layout 的 inspection 可执行命令，仅用于操作者信任的工作区，需显式授权。',
    tags: ['intoto', 'verify'],
    params: [],
  },
  {
    name: 'ipfs_status', provider: 'IPFS / Kubo', category: 'content', credits: 2, readOnly: true, live: false,
    zh: '连接配置的 Kubo RPC 并读取真实节点版本。',
    tags: ['ipfs', 'status'],
    params: [],
  },
  {
    name: 'mesh_schema', provider: 'Heurist Mesh / Bankr', category: 'market', credits: 4, readOnly: true, live: false,
    zh: '查询 Heurist Mesh 官方原生工具 Schema 和价格。',
    tags: ['mesh', 'schema'],
    params: [],
  },
  {
    name: 'openlineage_emit', provider: 'C2PA / in-toto / OpenLineage / OTS', category: 'identity', credits: 3, readOnly: false, live: false,
    zh: '通过 OpenLineage 官方 HTTP 协议提交已有 RunEvent 文件，保留原生 facets。',
    tags: ['openlineage', 'emit'],
    params: [],
  },
  {
    name: 'ots_info', provider: 'C2PA / in-toto / OpenLineage / OTS', category: 'identity', credits: 3, readOnly: true, live: false,
    zh: '官方 OpenTimestamps 客户端解析 .ots 证明；不声称已确认 Bitcoin 时间。',
    tags: ['ots', 'info'],
    params: [],
  },
  {
    name: 'provenance_status', provider: 'C2PA / in-toto / OpenLineage / OTS', category: 'identity', credits: 3, readOnly: true, live: false,
    zh: '检查已安装的官方来源验证程序；不自动安装。',
    tags: ['provenance', 'status'],
    params: [],
  },
  {
    name: 'safe_prepare', provider: 'Safe / x402', category: 'chain', credits: 2, readOnly: false, live: false,
    zh: '官方 Safe SDK 构建待签名交易并计算 Safe transaction hash；不签署、不发送。',
    tags: ['safe', 'prepare'],
    params: [],
  },
  {
    name: 'sas_attestation', provider: 'Sui / Aptos / Sign Protocol', category: 'chain', credits: 2, readOnly: false, live: false,
    zh: '官方 sas-lib 读取原生声明并检查程序所有者；不将存在性等同于可信。',
    tags: ['sas', 'attestation'],
    params: [],
  },
  {
    name: 'sas_schema', provider: 'Sui / Aptos / Sign Protocol', category: 'chain', credits: 2, readOnly: true, live: false,
    zh: '官方 sas-lib 读取 Schema。',
    tags: ['sas', 'schema'],
    params: [],
  },
  {
    name: 'sign_attest', provider: 'Sui / Aptos / Sign Protocol', category: 'chain', credits: 2, readOnly: false, live: false,
    zh: '官方 Sign Protocol SDK 创建链上声明；需配置开发签署账户。',
    tags: ['sign', 'attest'],
    params: [],
  },
  {
    name: 'sign_attestation', provider: 'Sui / Aptos / Sign Protocol', category: 'chain', credits: 2, readOnly: false, live: false,
    zh: '官方 Sign Protocol SDK 查询原生声明。',
    tags: ['sign', 'attestation'],
    params: [],
  },
  {
    name: 'sign_revoke', provider: 'Sui / Aptos / Sign Protocol', category: 'chain', credits: 2, readOnly: false, live: false,
    zh: '官方 Sign Protocol SDK 撤销声明。',
    tags: ['sign', 'revoke'],
    params: [],
  },
  {
    name: 'sign_schema', provider: 'Sui / Aptos / Sign Protocol', category: 'chain', credits: 2, readOnly: true, live: false,
    zh: '官方 Sign Protocol SDK 查询 EVM Schema。',
    tags: ['sign', 'schema'],
    params: [],
  },
  {
    name: 'sui_transaction', provider: 'Sui / Aptos / Sign Protocol', category: 'chain', credits: 2, readOnly: true, live: false,
    zh: '官方 Sui SDK 查询交易及 effects。',
    tags: ['sui', 'transaction'],
    params: [],
  },
  {
    name: 'sui_transaction_inspect', provider: 'Sui / Aptos / Sign Protocol', category: 'chain', credits: 2, readOnly: true, live: false,
    zh: '用官方 Transaction 解析已序列化交易；离线、不签名。',
    tags: ['sui', 'transaction', 'inspect'],
    params: [],
  },
  {
    name: 'system_setup', provider: 'builtin', category: 'system', credits: 0, readOnly: true, live: false,
    zh: '生成项目 Codex/Claude Code MCP 配置及工作流；可从实际包准备固定官方组件，备份并保留其他条目。',
    tags: ['system', 'setup'],
    params: [],
  },
  {
    name: 'viem_chain', provider: 'viem', category: 'chain', credits: 1, readOnly: true, live: false,
    zh: '使用 viem 连接配置的 RPC，核对 chain ID 并读取最新区块号。',
    tags: ['viem', 'chain'],
    params: [],
  },
  {
    name: 'viem_read', provider: 'viem', category: 'chain', credits: 1, readOnly: true, live: false,
    zh: '使用 viem 调用真实只读合约方法；ABI 由调用者提供，结果按 viem 类型序列化。',
    tags: ['viem', 'read'],
    params: [],
  },
  {
    name: 'viem_transaction', provider: 'viem', category: 'chain', credits: 1, readOnly: true, live: false,
    zh: '使用 viem 读取真实交易与回执；未找到时 found=false，不推断成功。',
    tags: ['viem', 'transaction'],
    params: [],
  },
  {
    name: 'walrus_read', provider: 'Arweave / Walrus', category: 'content', credits: 2, readOnly: true, live: false,
    zh: '通过官方 Walrus aggregator HTTP API 读取 blob；返回 base64。',
    tags: ['walrus', 'read'],
    params: [],
  },
  {
    name: 'workstation_guide', provider: 'builtin', category: 'system', credits: 0, readOnly: true, live: false,
    zh: '按开发、NFT、数据查询或安全检查任务返回对应步骤、实际连接条件与待补参数。',
    tags: ['workstation', 'guide'],
    params: [],
  },
  {
    name: 'workstation_list', provider: 'builtin', category: 'system', credits: 0, readOnly: true, live: false,
    zh: '列出工作站与可选工具。',
    tags: ['workstation', 'list'],
    params: [],
  },
  {
    name: 'x402_decode', provider: 'Safe / x402', category: 'chain', credits: 2, readOnly: true, live: false,
    zh: '使用官方 x402 SDK 解码 PAYMENT-REQUIRED、PAYMENT-SIGNATURE 或 PAYMENT-RESPONSE；解码不代表已付款。',
    tags: ['x402', 'decode'],
    params: [],
  },
  {
    name: 'x402_verify', provider: 'Safe / x402', category: 'chain', credits: 2, readOnly: true, live: false,
    zh: '官方 x402 facilitator 校验支付授权；不结算、不转账。',
    tags: ['x402', 'verify'],
    params: [],
  },

  // ---------- v1.1：价格、协议数据、报价、ABI、账户抽象、交易模拟 ----------
  {
    name: 'chainlink_price', provider: 'Chainlink', category: 'market', credits: 1, readOnly: true, live: false,
    zh: '读取 Chainlink 喂价合约的最新报价、精度与更新时间，并给出陈旧判定。走已配置 RPC，无需密钥。',
    tags: ['价格', '喂价', 'price', 'chainlink', 'oracle', '预言机', '报价', 'eth', 'btc', '行情'],
    params: [P('pair', 'string', false, '交易对，如 ETH/USD；主网支持 8 个常用对'), P('feed', 'address', false, '喂价合约地址，其他链用这个')],
  },
  {
    name: 'defillama_protocol', provider: 'DefiLlama', category: 'market', credits: 1, readOnly: true, live: false,
    zh: '查询单个协议的最新 TVL、类别、所属链与 7 日变化。公开接口，无需密钥。',
    tags: ['tvl', '协议', 'defillama', '资金', '规模', '锁仓', 'protocol', '借贷', 'dex'],
    params: [P('slug', 'string', true, '协议标识，如 uniswap、aave、lido')],
  },
  {
    name: 'defillama_chains', provider: 'DefiLlama', category: 'market', credits: 1, readOnly: true, live: false,
    zh: '按 TVL 排序查询各条链的规模。公开接口，无需密钥。',
    tags: ['链', 'tvl', '排名', 'defillama', '公链', '生态', 'chains'],
    params: [P('limit', 'number', false, '返回前 N 条，默认 10')],
  },
  {
    name: 'jupiter_quote', provider: 'Jupiter', category: 'market', credits: 1, readOnly: true, live: false,
    zh: '通过 Jupiter 获取 Solana 代币兑换报价（只读报价，不构造、不提交交易）。',
    tags: ['solana', '报价', 'swap', 'jupiter', '滑点', '兑换', 'quote', 'sol'],
    params: [P('inputMint', 'string', true, '输入代币，可用 SOL/USDC/USDT/JUP/BONK 简写'), P('outputMint', 'string', true, '输出代币'), P('amount', 'string', true, '输入数量，最小单位')],
  },
  {
    name: 'explorer_abi', provider: 'Etherscan v2', category: 'dev', credits: 1, readOnly: true, live: false,
    zh: '从 Etherscan v2 读取已验证合约的 ABI，供 Agent 构造调用。需要 BCA_ETHERSCAN_API_KEY。',
    tags: ['abi', '合约', 'etherscan', '接口', '调用', '验证', '函数'],
    params: [P('address', 'address', true, '合约地址'), P('chainId', 'string', false, '链 ID，默认 1')],
  },
  {
    name: 'aa_entrypoints', provider: 'ERC-4337', category: 'chain', credits: 1, readOnly: true, live: false,
    zh: '查询 bundler 支持的 EntryPoint 版本。需要 BCA_BUNDLER_URL。',
    tags: ['4337', '账户抽象', 'entrypoint', 'bundler', 'aa', '智能账户'],
    params: [],
  },
  {
    name: 'aa_userop_receipt', provider: 'ERC-4337', category: 'chain', credits: 1, readOnly: true, live: false,
    zh: '按 userOpHash 查询 UserOperation 执行回执；未打包时返回 found=false。需要 BCA_BUNDLER_URL。',
    tags: ['4337', 'userop', '账户抽象', '回执', 'aa', 'bundler'],
    params: [P('userOpHash', 'string', true, 'UserOperation 哈希')],
  },
  {
    name: 'tx_simulate', provider: 'Tenderly', category: 'security', credits: 3, readOnly: true, live: false,
    zh: '在上链前模拟一次合约调用，返回是否回滚、gas 消耗与错误原因。需要 Tenderly 三件套变量。',
    tags: ['模拟', '预执行', 'simulate', 'tenderly', '安全', '回滚', 'gas'],
    params: [P('to', 'address', true, '目标合约'), P('from', 'address', false, '模拟调用方'), P('input', 'string', false, '调用数据 0x…'), P('value', 'string', false, '附带的 wei 数量')],
  },
];

// ---------- 检索 ----------
const norm = (s) => (s || '').toLowerCase().replace(/[\s_\-/]+/g, ' ').trim();

function bigrams(s) {
  const t = s.replace(/[^\p{L}\p{N}]/gu, '');
  const out = new Set();
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
  return out;
}

function score(tool, q) {
  const nq = norm(q);
  if (!nq) return 1;
  const hay = norm([tool.name, tool.zh, tool.provider, (tool.tags || []).join(' ')].join(' '));
  let s = 0;

  if (norm(tool.name) === nq) s += 120;
  if (norm(tool.name).includes(nq)) s += 45;

  for (const tok of nq.split(' ')) {
    if (!tok) continue;
    if (norm(tool.name).includes(tok)) s += 26;
    if (hay.includes(tok)) s += 12;
    for (const tag of tool.tags || []) {
      const nt = norm(tag);
      if (nt === tok) s += 30;
      else if (nt.includes(tok) || tok.includes(nt)) s += 14;
    }
  }

  // 中文按字符二元组重合度
  const qb = bigrams(nq);
  if (qb.size) {
    const hb = bigrams(hay);
    let hit = 0;
    for (const b of qb) if (hb.has(b)) hit++;
    s += Math.round((hit / qb.size) * 55);
  }
  return s;
}

export function searchTools(q, { category, limit = 8 } = {}) {
  let pool = TOOLS;
  if (category && category !== 'all') pool = pool.filter((t) => t.category === category);
  return pool
    .map((t) => ({ tool: t, s: score(t, q) }))
    .filter((x) => x.s >= 12)
    .sort((a, b) => b.s - a.s || a.tool.credits - b.tool.credits)
    .slice(0, limit)
    .map((x) => ({ ...x.tool, _score: x.s }));
}

export function getTool(name) {
  return TOOLS.find((t) => t.name === name) || null;
}


export const STATS = {
  tools: TOOLS.length,
  providers: [...new Set(TOOLS.map((t) => t.provider))].length,
  live: TOOLS.filter((t) => t.live).length,
  categories: Object.keys(CATEGORIES).length,
};
