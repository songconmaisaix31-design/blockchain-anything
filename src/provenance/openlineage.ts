import { randomUUID } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { Config } from '../config.js';
import { defineTool } from '../types.js';
import { readProvenanceConfig } from './config.js';
import { ensureDirectory, resolveExisting } from './files.js';
import { binaryTimeout } from './binaries.js';
import { commandOutput, runCommand } from './exec.js';

const OPENLINEAGE_HELPER = `
import json
import os
import sys

from openlineage.client import OpenLineageClient
from openlineage.client.run import Dataset, Job, Run, RunEvent, RunState
from openlineage.client.transport.file import FileConfig, FileTransport

payload = json.loads(sys.argv[1])
output_dir = sys.argv[2]
state = getattr(RunState, payload["eventType"])
event = RunEvent(
    eventType=state,
    eventTime=payload.get("eventTime"),
    run=Run(runId=payload["runId"]),
    job=Job(namespace=payload["jobNamespace"], name=payload["jobName"]),
    inputs=[Dataset(namespace=item["namespace"], name=item["name"]) for item in payload.get("inputs", [])],
    outputs=[Dataset(namespace=item["namespace"], name=item["name"]) for item in payload.get("outputs", [])],
    producer=payload["producer"],
)
client = OpenLineageClient(
    transport=FileTransport(FileConfig(log_file_path=os.path.join(output_dir, "event.jsonl"), append=False))
)
client.emit(event)
files = [os.path.join(output_dir, name) for name in os.listdir(output_dir)]
if not files:
    raise SystemExit("OpenLineage FileTransport 未写出事件文件")
newest = max(files, key=os.path.getmtime)
print(json.dumps({"file": newest}))
`;

const dataset = z.strictObject({
  namespace: z.string().min(1).max(1024),
  name: z.string().min(1).max(1024),
});

export function openLineageTools(config: Config) {
  const provenance = readProvenanceConfig(config);
  return [
    defineTool('openlineage_emit', '使用官方 openlineage-python 客户端构造并发射真实 OpenLineage RunEvent；使用官方 FileTransport 写出事件后读取并返回原始事件 JSON。',
      z.strictObject({
        jobNamespace: z.string().min(1),
        jobName: z.string().min(1),
        eventType: z.enum(['START', 'RUNNING', 'COMPLETE', 'ABORT', 'FAIL', 'OTHER']),
        runId: z.string().regex(/^[0-9a-fA-F-]{36}$/, '必须为 UUID 字符串').optional(),
        eventTime: z.string().min(1).optional(),
        inputs: z.array(dataset).max(100).optional(),
        outputs: z.array(dataset).max(100).optional(),
        producer: z.string().url().optional(),
        timeoutMs: z.number().int().positive().max(300_000).optional(),
      }),
      false,
      async ({ jobNamespace, jobName, eventType, runId, eventTime, inputs, outputs, producer, timeoutMs }) => {
        const directory = await ensureDirectory(provenance, join('.work', `openlineage-${randomUUID()}`));
        const effectiveRunId = runId ?? randomUUID();
        const payload = {
          jobNamespace,
          jobName,
          eventType,
          runId: effectiveRunId,
          eventTime: eventTime ?? new Date().toISOString(),
          inputs: inputs ?? [],
          outputs: outputs ?? [],
          producer: producer ?? 'https://github.com/songconmaisaix31-design/blockchain-anything',
        };
        try {
          const result = await runCommand(provenance.pythonPath, ['-c', OPENLINEAGE_HELPER, JSON.stringify(payload), directory], {
            timeoutMs: binaryTimeout(provenance, timeoutMs),
          });
          if (result.code !== 0) throw new Error(`OpenLineage 发射失败：${commandOutput(result)}`);
          const parsed = JSON.parse(result.stdout.trim()) as { file?: string };
          if (!parsed.file) throw new Error('OpenLineage 客户端未返回事件文件路径');
          const eventPath = await resolveExisting(provenance, parsed.file);
          const text = await readFile(eventPath, 'utf8');
          const event = JSON.parse(text) as Record<string, unknown>;
          return {
            emitted: true,
            tool: 'openlineage-python',
            runId: effectiveRunId,
            event,
            transport: 'file',
            trustBoundary: '事件由官方 Python 客户端构造并按 OpenLineage JSON Schema 序列化；临时事件文件在返回前删除，本工具不验证下游 collector 是否接收或持久化。',
          };
        } finally {
          await rm(directory, { recursive: true, force: true });
        }
      }),
  ];
}
