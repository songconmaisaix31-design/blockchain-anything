import { z } from 'zod';
import type { Config } from '../config.js';
import { defineTool } from '../types.js';
import { readProvenanceConfig } from './config.js';
import { resolveExisting } from './files.js';
import { binaryTimeout } from './binaries.js';
import { commandOutput, runCommand } from './exec.js';

const STATEMENT_HELPER = `
import json
import sys

try:
    from google.protobuf import json_format
    from in_toto_attestation.v1 import statement_pb2
    from in_toto_attestation.v1.statement import Statement
except Exception as error:
    print(json.dumps({"valid": False, "error": "缺少官方 Python 包 in-toto-attestation/google-protobuf: " + str(error)}))
    raise SystemExit(0)

with open(sys.argv[1], encoding="utf-8") as handle:
    try:
        data = json.load(handle)
    except Exception as error:
        print(json.dumps({"valid": False, "error": "JSON 无效: " + str(error)}))
        raise SystemExit(0)

try:
    proto = json_format.ParseDict(data, statement_pb2.Statement())
    statement = Statement.copy_from_pb(proto)
    statement.validate()
    subjects = []
    for subject in statement.pb.subject:
        subjects.append({"name": subject.name, "digest": dict(subject.digest)})
    print(json.dumps({
        "valid": True,
        "type": statement.pb.type,
        "subjectCount": len(statement.pb.subject),
        "subjects": subjects,
        "predicateType": statement.pb.predicate_type,
        "predicateKeys": sorted(statement.pb.predicate.keys()),
    }))
except Exception as error:
    print(json.dumps({"valid": False, "error": str(error)}))
`;

interface StatementResult {
  valid: boolean;
  error?: string;
  type?: string;
  subjectCount?: number;
  subjects?: Array<{ name?: string; digest?: Record<string, string> }>;
  predicateType?: string;
  predicateKeys?: string[];
}

function parseStatementOutput(result: { code: number | null; stdout: string; stderr: string }): StatementResult {
  const text = result.stdout.trim();
  if (!text) throw new Error(`in-toto statement 校验器无输出：${result.stderr.trim()}`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`in-toto statement 校验器返回非 JSON：${text.slice(0, 500)}`);
  }
  if (!parsed || typeof parsed !== 'object') throw new Error('in-toto statement 校验器返回无效对象');
  return parsed as StatementResult;
}

export function inTotoTools(config: Config) {
  const provenance = readProvenanceConfig(config);
  return [
    defineTool('intoto_verify_link', '调用官方 in-toto-sign --verify 校验 link metadata 的签名；只验证元数据签名，不验证 layout 策略或待验证产物哈希。',
      z.strictObject({
        linkPath: z.string().min(1),
        publicKeyPath: z.string().min(1),
        timeoutMs: z.number().int().positive().max(300_000).optional(),
      }),
      true,
      async ({ linkPath, publicKeyPath, timeoutMs }) => {
        const link = await resolveExisting(provenance, linkPath);
        const key = await resolveExisting(provenance, publicKeyPath);
        const result = await runCommand(provenance.inTotoSignPath, ['-f', link, '-k', key, '--verify'], {
          timeoutMs: binaryTimeout(provenance, timeoutMs),
        });
        if (result.code !== 0 && result.code !== 2) {
          throw new Error(`in-toto-sign 执行失败：${commandOutput(result)}`);
        }
        return {
          verified: result.code === 0,
          tool: 'in-toto-sign',
          linkPath,
          publicKeyPath,
          output: commandOutput(result),
          layoutPolicyChecked: false,
          artifactHashesChecked: false,
          trustBoundary: '仅验证 link metadata 的签名与签名者密钥；不验证 layout 授权、阈值、step 顺序或 link 中记录的产物哈希是否与磁盘一致。',
        };
      }),
    defineTool('intoto_validate_statement', '使用官方 in-toto-attestation protobuf 定义解析并校验 in-toto Statement v1 的 type、subjects、digest、predicate type 和 predicate 结构。',
      z.strictObject({
        statementPath: z.string().min(1),
        timeoutMs: z.number().int().positive().max(300_000).optional(),
      }),
      true,
      async ({ statementPath, timeoutMs }) => {
        const path = await resolveExisting(provenance, statementPath);
        const result = await runCommand(provenance.pythonPath, ['-c', STATEMENT_HELPER, path], {
          timeoutMs: binaryTimeout(provenance, timeoutMs),
        });
        if (result.code !== 0) {
          throw new Error(`in-toto statement 校验器失败：${commandOutput(result)}`);
        }
        return {
          statementPath,
          tool: 'in-toto-attestation',
          ...parseStatementOutput(result),
          trustBoundary: '校验的是 in-toto Statement v1 的结构与字段，不是 DSSE 签名；签名需由 Sigstore/cosign 或其他 DSSE 验证器另行校验。',
        };
      }),
  ];
}
