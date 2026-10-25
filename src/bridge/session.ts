import { createHash, randomUUID } from 'node:crypto';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import type { Config } from '../config.js';
import { VERSION } from '../version.js';
import { loadMcpServers, loadMcpConfiguration, type ResolvedServer } from './config.js';

type UpstreamTool = Awaited<ReturnType<Client['listTools']>>['tools'][number];
interface Entry {
  id: string; server: ResolvedServer; identity: string; client: Client;
  transport: StdioClientTransport | StreamableHTTPClientTransport;
  timer?: ReturnType<typeof setTimeout>; busy: boolean; closed: boolean;
  snapshot?: { tools: UpstreamTool[]; digest: string; fetchedAt: string; expires: number };
  previousDigest?: string;
}
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Owned by one toolkit. No credentials or connections cross toolkit instances. */
export class BridgeSessions {
  private entries = new Map<string, Entry>();
  constructor(private config: Config) {}

  async open(serverName: string) {
    const configuration = await loadMcpConfiguration(this.config.workingRoot);
    if (configuration.errors[serverName]) throw new Error(configuration.errors[serverName]);
    const server = configuration.servers[serverName];
    if (!server) throw new Error(`未知 MCP 服务：${serverName}`);
    if (this.entries.size >= 16) throw new Error('最多 16 个会话；先 bridge_close');
    const transport = server.transport === 'http'
      ? new StreamableHTTPClientTransport(new URL(server.url), { requestInit: { headers: server.headers } })
      : new StdioClientTransport({ command: server.command, args: server.args, env: server.env, cwd: server.cwd, stderr: 'pipe' });
    if (transport instanceof StdioClientTransport) transport.stderr?.on('data', () => { /* drain, never disclose credentials */ });
    let entry: Entry;
    const client = new Client({ name: 'bca', version: VERSION }, {
      inputRequired: { autoFulfill: false },
      listMaxPages: 20,
      // Invalidate immediately: the SDK's default debounce can leave the old
      // schema active for a call made just after tools/list_changed.
      listChanged: { tools: { autoRefresh: false, debounceMs: 0, onChanged: () => { if (entry) { entry.previousDigest = entry.snapshot?.digest ?? entry.previousDigest; entry.snapshot = undefined; } } } },
    });
    entry = { id: randomUUID(), server, identity: digest(server), client, transport, busy: false, closed: false };
    client.onclose = () => { entry.closed = true; entry.snapshot = undefined; };
    try { await client.connect(transport, { timeout: this.config.timeoutMs }); }
    catch (error) { await transport.close(); throw this.redact(error, server); }
    this.entries.set(entry.id, entry);
    this.arm(entry);
    return { session: entry.id, server: serverName, serverInfo: client.getServerVersion(), idleTimeoutMs: 300_000, connectionVerified: true, businessVerified: false };
  }

  private arm(entry: Entry) {
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => { void this.close(entry.id).catch(() => {}); }, 300_000);
    entry.timer.unref();
  }

  private redact(error: unknown, server: ResolvedServer) {
    let message = error instanceof Error ? error.message : 'MCP 操作失败';
    const secrets = server.transport === 'http' ? [...Object.values(server.headers), server.url] : [...Object.values(server.env), ...server.args];
    for (const secret of secrets.filter(Boolean).sort((a, b) => b.length - a.length)) {
      message = message.split(secret).join('[REDACTED]');
      const token = secret.replace(/^(Bearer|Basic)\s+/i, '');
      if (token) message = message.split(token).join('[REDACTED]');
    }
    return new Error(message);
  }

  async close(id: string) {
    const entry = this.entries.get(id);
    if (!entry) return { session: id, closed: true };
    clearTimeout(entry.timer);
    this.entries.delete(id);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        entry.client.close().then(() => entry.transport.close()),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('MCP 会话关闭超过 3000ms，清理未确认')), 3000); }),
      ]);
    } finally { clearTimeout(timer); }
    return { session: id, closed: true };
  }

  async closeAll() {
    const results = await Promise.allSettled([...this.entries.keys()].map((id) => this.close(id)));
    if (results.some((result) => result.status === 'rejected')) throw new Error('部分 MCP 会话清理未确认');
  }

  async use<T>(serverName: string, session: string | undefined, operation: (client: Client, server: ResolvedServer, entry: Entry) => Promise<T>): Promise<T> {
    const id = session ?? (await this.open(serverName)).session;
    const entry = this.entries.get(id);
    if (!entry) throw new Error('会话不存在或已过期；请显式重新 bridge_open');
    if (entry.busy) throw new Error('同一会话正在执行；请等待上次调用完成');
    const current = (await loadMcpServers(this.config.workingRoot))[serverName];
    if (entry.closed || entry.server.name !== serverName || !current || digest(current) !== entry.identity) {
      await this.close(id);
      throw new Error('会话已断开或配置/凭据已变更；请显式重新连接，未知写入先查询状态');
    }
    entry.busy = true;
    clearTimeout(entry.timer);
    try { return await operation(entry.client, entry.server, entry); }
    catch (error) {
      await this.close(id);
      throw this.redact(error, entry.server);
    } finally {
      entry.busy = false;
      if (!session) await this.close(id);
      else if (this.entries.has(id)) this.arm(entry);
    }
  }

  async list(entry: Entry, refresh = false) {
    if (refresh || !entry.snapshot || entry.snapshot.expires <= Date.now()) {
      const tools: UpstreamTool[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 20; page++) {
        const result = await entry.client.listTools({ cursor }, { timeout: this.config.timeoutMs, cacheMode: 'refresh' });
        tools.push(...result.tools);
        cursor = result.nextCursor;
        if (!cursor) break;
      }
      if (cursor) throw new Error('tools/list 超过 20 页，未完整发现');
      entry.previousDigest = entry.snapshot?.digest ?? entry.previousDigest;
      entry.snapshot = { tools, digest: digest({ version: entry.client.getServerVersion(), tools }), fetchedAt: new Date().toISOString(), expires: Date.now() + 30_000 };
    }
    return { tools: entry.snapshot.tools, schemaDigest: entry.snapshot.digest, changed: entry.previousDigest ? entry.previousDigest !== entry.snapshot.digest : null,
      fetchedAt: entry.snapshot.fetchedAt, status: 'discovered_unverified', businessVerified: false, authorizationChanged: false };
  }
}
