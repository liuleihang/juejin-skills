// 文章 frontmatter 格式检查 + 字段归一化：缺失提示、给建议、规则可自定义
// 用法：
//   node scripts/frontmatter.mjs article.md
//   node scripts/frontmatter.mjs article.md --json
//   node scripts/frontmatter.mjs article.md --strict
//   node scripts/frontmatter.mjs article.md --require title,description
// 规则自定义：~/.juejin/config.json 的 frontmatter.required
import fs from 'node:fs';
import path from 'node:path';
import { CFG } from './config.mjs';
import { isMain } from './is-main.mjs';

const DEFAULT_FIELDS = Array.isArray(CFG.frontmatter && CFG.frontmatter.required)
  ? CFG.frontmatter.required
  : [];

// 与 publish.mjs 原解析器逐字一致，搬迁目的是让检查与发布共用一套规则，避免漂移。
export function parseFrontmatter(md) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(md);
  const meta = {};
  let body = md;
  if (m) {
    for (const line of m[1].split(/\r?\n/)) {
      const kv = /^(\w[\w-]*):\s*(.*)$/.exec(line.trim());
      if (kv) meta[kv[1].toLowerCase()] = kv[2].trim().replace(/^["']|["']$/g, '');
    }
    body = md.slice(m[0].length);
  }
  return { meta, body };
}

function normValue(v) {
  if (v === undefined || v === null) return '';
  const s = String(v).trim();
  if (!s || ['[]', '{}', 'null', '""', "''"].includes(s)) return '';
  if (/^\[\s*\]$/.test(s)) return '';
  return s;
}

// 别名折叠：规范 key 有值则保留，否则用第一个非空别名补齐。
// 让「检查通过」与「发布实际取值」共用同一份 meta，避免静默不一致。
export function normalizeMeta(meta, fields = DEFAULT_FIELDS) {
  const out = { ...meta };
  for (const f of fields) {
    const key = String(f.key).toLowerCase();
    if (normValue(out[key])) continue;
    for (const a of f.aliases || []) {
      const v = normValue(out[String(a).toLowerCase()]);
      if (v) { out[key] = v; break; }
    }
  }
  return out;
}

// 同时兼容 blog 的 YAML 数组 [a, b] 与掘金原有的逗号串 a,b。
export function splitTags(v) {
  const s = String(v == null ? '' : v).trim().replace(/^\[|\]$/g, '');
  return s.split(/[,，]/).map((x) => x.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
}

function toField(f) {
  return typeof f === 'string'
    ? { key: f, label: f, aliases: [], suggestion: '', example: `${f}: `, publish: false }
    : f;
}

export function checkFrontmatter(md, opts = {}) {
  const fields = (opts.required || DEFAULT_FIELDS).map(toField);
  const { meta } = parseFrontmatter(md);
  const hasFrontmatter = /^---\r?\n/.test(md);
  const items = fields.map((f) => {
    const keys = [f.key, ...(f.aliases || [])].map((k) => String(k).toLowerCase());
    const matchedKey = keys.find((k) => normValue(meta[k])) || null;
    return {
      key: f.key,
      label: f.label || f.key,
      aliases: f.aliases || [],
      present: Boolean(matchedKey),
      matchedKey,
      value: matchedKey ? normValue(meta[matchedKey]) : '',
      suggestion: f.suggestion || '',
      example: f.example || `${f.key}: `,
      publish: f.publish !== false,
    };
  });
  const missing = items.filter((i) => !i.present);
  const snippet = missing.length
    ? ['---', ...missing.map((i) => i.example), '---'].join('\n')
    : '';
  return { hasFrontmatter, checked: items.length, missingCount: missing.length, items, missing, snippet };
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function formatReport(r) {
  const lines = [];
  if (!r.hasFrontmatter) lines.push('[frontmatter] ⚠ 未检测到 frontmatter（文件须以 --- 开头）');
  if (!r.missingCount) {
    lines.push(`[frontmatter] ✓ 元数据完整：${r.checked} 项全部就位`);
    return lines.join('\n');
  }
  lines.push(`[frontmatter] ⚠ 元数据检查：${r.missingCount} 项缺失（共 ${r.checked} 项）`);
  for (const i of r.missing) {
    lines.push(`  ✗ ${i.key}（${i.label}）：未提供${i.publish ? '' : '（本地规范字段，不参与掘金发布）'}`);
    if (i.aliases.length) lines.push(`      兼容别名：${i.aliases.join(' / ')}`);
    if (i.suggestion) lines.push(`      建议：${i.suggestion}`);
    if (i.example) lines.push(`      示例：${i.example.replace('YYYY-MM-DD', today())}`);
  }
  const ok = r.items.filter((x) => x.present).map((x) =>
    `${x.key}${String(x.key).toLowerCase() !== x.matchedKey ? `(来自 ${x.matchedKey})` : ''}`);
  if (ok.length) lines.push(`  ✓ 已就位：${ok.join(' / ')}`);
  lines.push('');
  lines.push('[frontmatter] 可补齐以下内容到文件头部（仅提示，不会改写文件）：');
  lines.push(r.snippet.replace('YYYY-MM-DD', today()).split('\n').map((l) => '    ' + l).join('\n'));
  lines.push('');
  lines.push('[frontmatter] 自定义规则：编辑 ~/.juejin/config.json 的 frontmatter.required；');
  lines.push('              或本次临时覆盖：--require title,description');
  return lines.join('\n');
}

function parseCli(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') o.json = true;
    else if (a === '--strict') o.strict = true;
    else if (a === '--require') o.require = String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
    else o._.push(a);
  }
  return o;
}

async function main() {
  const args = parseCli(process.argv.slice(2));
  const file = args._[0];
  if (!file) {
    console.error('用法：node scripts/frontmatter.mjs <article.md> [--json] [--strict] [--require a,b]');
    process.exit(1);
  }
  const abs = path.resolve(file);
  if (!/\.(md|markdown)$/i.test(abs)) throw new Error('仅支持 .md / .markdown 文件');
  const md = fs.readFileSync(abs, 'utf8');
  const required = args.require
    ? args.require.map((k) => DEFAULT_FIELDS.find((f) => f.key === k) || toField(k))
    : undefined;
  const r = checkFrontmatter(md, { required });
  console.log(args.json ? JSON.stringify(r, null, 2) : formatReport(r));
  if (r.missingCount && args.strict) process.exit(2);
}

// 守卫统一收敛到 is-main.mjs（junction 与 node - 两种场景均已覆盖）
if (isMain(import.meta.url)) main().catch((err) => {
  console.error('[frontmatter] 失败：', err.message);
  process.exit(1);
});
