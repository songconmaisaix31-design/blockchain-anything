import { parentPort, workerData } from 'node:worker_threads';
import type { NativeAgentAction } from './index.js';

// One operator-owned SDK instance per invocation; no background agent loop.
const { moduleUrl, call, maxBytes } = workerData as {
  moduleUrl: string;
  call?: { name: string; arguments: Record<string, unknown> };
  maxBytes: number;
};
try {
  const module = await import(moduleUrl);
  if (typeof module.default !== 'function') throw new Error('工厂模块必须 default export 异步函数');
  const actions: NativeAgentAction[] = await module.default();
  if (!Array.isArray(actions) || actions.some((action) => !action.name || !action.inputSchema || typeof action.invoke !== 'function')) throw new Error('工厂未返回有效 NativeAgentAction[]');
  if (new Set(actions.map((action) => action.name)).size !== actions.length) throw new Error('工厂返回重复 action 名称');
  let result: unknown;
  if (call) {
    const action = actions.find((item) => item.name === call.name);
    if (!action) throw new Error(`未知 action：${call.name}`);
    result = await action.invoke(call.arguments);
  } else result = actions.map(({ invoke: _, ...action }) => action);
  const json = JSON.stringify(result ?? null, (_key, value) => typeof value === 'bigint' ? value.toString() : value);
  if (Buffer.byteLength(json) > maxBytes) throw new Error('SDK 返回内容超过读取大小上限');
  parentPort!.postMessage({ ok: true, json });
} catch (error) {
  parentPort!.postMessage({ ok: false, error: error instanceof Error ? error.message : 'SDK 调用失败' });
}
