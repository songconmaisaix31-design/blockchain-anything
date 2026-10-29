# GoPlus 公开代币风险查询

`goplus_token_security` 读取 GoPlus 官方公开 Token Security API。提供 EVM 链 ID 和一个 ERC20 合约地址即可调用，无需账户、API Key 或交易签名。

```powershell
node dist/cli/main.js call goplus_token_security --input '{"chainId":"1","address":"0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"}'
```

接口返回 `provider`、`access: "public"`、`chainId`、规范化为小写的 `address`、官方请求地址 `source`、接收时间 `queriedAt`，以及完整上游 JSON `response`。风险数据位于 `response.result[address]`。字段名称、字符串值、空值和嵌套数据均保留；缺失字段表示上游没有提供该项结果。字段解释见 [GoPlus 官方说明](https://docs.gopluslabs.io/reference/response-details)。

每次请求仅读取一个地址。工具直接调用固定官方域名，沿用 `BCA_TIMEOUT_MS` 与 `BCA_MAX_READ_BYTES` 限制。HTTP 失败、接口返回失败码、空结果和请求地址缺失均抛出错误；调用方可根据具体错误处理限流或输入问题。

`connect goplus` 继续配置官方 `goplus-mcp@1.0.1`，需要 `BCA_GOPLUS_API_KEY` 和 `BCA_GOPLUS_API_SECRET`。指定 MCP 服务后仍通过该服务发现和调用工具。公开 API 使用独立的 `goplus_token_security` 入口。

运行真实检查：

```powershell
node --import tsx scripts/check-goplus.ts
```

该脚本查询 Ethereum 和 Base 上的 USDC，再请求不受支持的链及无代币数据的地址，确认失败会传回调用方。USDC 地址取自 [Circle 官方目录](https://developers.circle.com/stablecoins/usdc-contract-addresses)，接口定义见 [GoPlus Token Security API](https://docs.gopluslabs.io/reference/tokensecurityusingget_1)。公开接口返回的字段取决于 GoPlus 的数据覆盖；例如 `b20_token` 需要 GoPlus 账户访问令牌。
