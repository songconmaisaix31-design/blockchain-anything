# BCA 交接

更新：2026-10-24。版本 0.3.0，开发分支 `codex/bca-s2-complete`，基于 `3db7f1f` 持续开发。当前实现、实际命令、首次失败与剩余条件集中记录在 [本轮验收](docs/acceptance/2026-10-24.md)。历史生态验收继续保留在 [S2 清单](tasks/S2-progress.md)，本轮没有重新认证全部供应商。

共享实现入口仍为 `src/toolkit.ts`。新增 `workstations/`、`setup.ts`、`development/workspace.ts` 和 `bridge/session.ts`。安装说明见 [setup](docs/guides/setup.md)，源码/trace 与会话边界见 [workstations](docs/guides/workstations.md)。

接手使用 Node 24.16+、`npm ci`、`npm run build`。按变更选择 `check:next -- regressions`、`check:next -- onchain`、`check:sessions`、`check:setup`；不要无变化地重复全生态验收。`check:setup` 用实际 tarball 和临时项目，包含网络安装，完成后清理。测试程序不会读取生产密钥或提交公共链交易。

剩余任务是原生 Windows/WSL2 客户端验收、账户型服务、公共链源码上传验证，以及按需扩展代理/嵌套 trace 的源码定位。未验证结果保持明确。只有满足原有全生态验收条件才合并 main；当前不满足。保持 `private:true`。
