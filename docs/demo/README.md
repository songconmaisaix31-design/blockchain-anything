# BCA 体验站 · Demo

BCA 的产品站与可运行的试用 Agent。纯静态页面 + 零依赖 Node 服务，没有构建步骤。

- **在线版**：https://songconmaisaix31-design.github.io/blockchain-anything/demo/
  静态托管，浏览器直接跑内置样本，用于演示交互与轨迹；接口不可用时不报错。
- **本地版**：`npm start` → http://localhost:4173
  页面走真实接口，余额、区块、代币风险、CID 计算等 15 个工具会真正打到链上数据源。

## 运行

```bash
cd docs/demo
npm start          # 或 node server/server.js；PORT=4174 可换端口
```

Node ≥ 20，无需 `npm install`。

## 目录

```
index.html          单文件产品站：hero / 三入口 / 试用 Agent / 工具目录 / 安全边界 / 定价 / FAQ
server/catalog.js   127 个工具的名称与描述，逐条取自仓库 src/**/defineTool 定义
server/executors.js 执行器：15 个接真实数据源，其余明确标记为 simulated
server/agent.js     试用 Agent：理解 → 检索 → 选工具 → 调用 → 回答
server/server.js    静态托管 + /api/{meta,tools,find,call,agent}
```

## 关于「真实」与「模拟」

页面上的每个工具都带状态标记，二者不混用：

| 标记 | 含义 |
|---|---|
| 可实时调用 | 有真实执行器，本地版会发起真实网络请求 |
| 演示 | 演示环境无执行器，返回占位结构，页面如实标注 |

真实执行器覆盖：EVM 余额 / 区块 / 交易回执（三个公共 RPC 轮询，失败自动切换）、
viem 只读调用、GoPlus 代币风险、CID 计算（CIDv1/raw/sha2-256）、DID 解析。

## 数据来源

工具目录不是手写的功能列表：名称与描述逐条抓自仓库源码的 `defineTool` 调用，
共 127 条，覆盖 8 个类别。仓库新增工具后重新提取即可，不需要维护第二份清单。

## 许可

与主仓库一致，MIT。
