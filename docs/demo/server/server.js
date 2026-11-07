// BCA 体验站服务端：零依赖，node server/server.js 即可启动。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOOLS, CATEGORIES, STATS, searchTools, getTool } from './catalog.js';
import { runTool } from './executors.js';
import { runAgent as runAgentRule, SUGGESTIONS } from './agent.js';

// BCA_AGENT=pi 时用真实 agent loop（pi + BCA MCP 工具层）；否则走内置规则引擎。
// 两者返回同样的轨迹结构，前端不需要区分。
const piAgent = process.env.BCA_AGENT === 'pi' ? await import('./agent-pi.js') : null;
const runAgent = piAgent ? (query, session) => piAgent.runAgentPi(query, session) : runAgentRule;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// 兼容两种布局：bca-site/{site,server} 与仓库内 docs/demo/{index.html,server}
const SITE = fs.existsSync(path.resolve(__dirname, '..', 'index.html'))
  ? path.resolve(__dirname, '..')
  : path.resolve(__dirname, '..', 'site');
const PORT = Number(process.env.PORT || 4173);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.md': 'text/markdown; charset=utf-8',
};

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req, limit = 256 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('请求体过大')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { reject(new Error('请求体不是合法 JSON')); }
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const abs = path.join(SITE, path.normalize(rel).replace(/^([/\\])+/, ''));
  if (!abs.startsWith(SITE)) { res.writeHead(403); res.end('forbidden'); return; }
  fs.readFile(abs, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found: ' + rel);
      return;
    }
    res.writeHead(200, {
      'content-type': MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const { pathname } = url;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'content-type',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
    });
    res.end();
    return;
  }

  try {
    if (pathname === '/api/health') {
      return json(res, 200, { ok: true, uptime: Math.round(process.uptime()), node: process.version });
    }

    if (pathname === '/api/meta') {
      const providers = [...new Set(TOOLS.map((t) => t.provider))];
      return json(res, 200, {
        stats: STATS,
        categories: CATEGORIES,
        providers,
        suggestions: SUGGESTIONS,
        pricing: {
          freeCredits: 2000,
          tiers: [
            { name: 'BYO', price: 0, credits: 0, note: '本地全功能不限量，自带密钥' },
            { name: 'Starter', price: 19, annual: 16, credits: 20000 },
            { name: 'Pro', price: 79, annual: 66, credits: 120000 },
            { name: 'Team', price: 299, annual: 249, credits: 600000 },
          ],
        },
      });
    }

    if (pathname === '/api/tools') {
      const q = url.searchParams.get('q') || '';
      const category = url.searchParams.get('category') || 'all';
      const list = q ? searchTools(q, { category, limit: 60 }) : TOOLS.filter((t) => category === 'all' || t.category === category);
      return json(res, 200, { total: list.length, tools: list });
    }

    if (pathname === '/api/find') {
      const q = url.searchParams.get('q') || '';
      if (!q) return json(res, 400, { error: '缺少 q 参数' });
      const hits = searchTools(q, { limit: Number(url.searchParams.get('limit') || 6) });
      return json(res, 200, {
        query: q,
        total: hits.length,
        matches: hits.map((t) => ({
          name: t.name, provider: t.provider, category: t.category,
          credits: t.credits, readOnly: t.readOnly, live: t.live,
          desc: t.zh, params: t.params,
        })),
      });
    }

    if (pathname === '/api/call') {
      const body = req.method === 'POST' ? await readBody(req) : {
        tool: url.searchParams.get('tool'),
        input: url.searchParams.get('input') ? JSON.parse(url.searchParams.get('input')) : {},
      };
      if (!body.tool) return json(res, 400, { error: '缺少 tool 字段' });
      if (!getTool(body.tool)) return json(res, 404, { error: `未知工具：${body.tool}` });
      const r = await runTool(body.tool, body.input || {});
      return json(res, r.ok ? 200 : 422, r);
    }

    if (pathname === '/api/agent') {
      const body = req.method === 'POST' ? await readBody(req) : { query: url.searchParams.get('query') };
      if (!body.query) return json(res, 400, { error: '缺少 query 字段' });
      const r = await runAgent(body.query);
      return json(res, 200, r);
    }

    if (pathname.startsWith('/api/')) return json(res, 404, { error: 'no such endpoint' });

    return serveStatic(req, res, pathname);
  } catch (e) {
    return json(res, 500, { error: String(e.message || e) });
  }
});

server.listen(PORT, () => {
  console.log('');
  console.log('  BCA 体验站已启动');
  console.log('  ─────────────────────────────');
  console.log(`  站点      http://localhost:${PORT}`);
  console.log(`  工具目录  ${STATS.tools} 个 / ${STATS.providers} 家供应商`);
  console.log(`  真实执行  ${STATS.live} 个工具可实时调用`);
  console.log('');
});
