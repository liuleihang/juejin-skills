#!/usr/bin/env node
// build-zip.mjs —— 把仓库打成 build/juejin-skills.zip（供上传 WorkBuddy），排除 .git 等本地/运行时产物。
// 零依赖（Node >= 18）：自实现 ZIP(deflate) + CRC32。
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(ROOT, 'build');
const OUT = path.join(OUT_DIR, 'juejin-skills.zip');

// 排除：版本库 / 依赖 / 本地凭据缓存 / 运行时日志 / 构建产物自身 / 图片资源（仅 README 展示用，不随包上传）
const EXCLUDE = new Set(['.git', 'node_modules', 'logs', '.juejin', 'build', 'assets']);
const EXCLUDE_EXT = new Set(['.bak']);

// WorkBuddy 平台上限：examples_zh / examples_en 各最多 3 条，超出会在上传解析阶段直接失败。
const MAX_EXAMPLES = 3;

function validateFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) throw new Error('SKILL.md 缺少 frontmatter');
  const lines = m[1].split(/\r?\n/);
  const counts = {};
  for (const key of ['examples_zh', 'examples_en']) {
    const start = lines.findIndex((l) => l.startsWith(key + ':'));
    if (start < 0) throw new Error(`frontmatter 缺少 ${key}`);
    let count = 0;
    for (let i = start + 1; i < lines.length; i++) {
      if (/^\S/.test(lines[i])) break;
      if (/^\s+-\s/.test(lines[i])) count++;
    }
    counts[key] = count;
    if (count > MAX_EXAMPLES) throw new Error(`${key} 有 ${count} 个示例，超过平台上限 ${MAX_EXAMPLES} 个`);
  }
  return counts;
}

const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDE.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { walk(full); continue; }
    if (EXCLUDE_EXT.has(path.extname(e.name))) continue;
    files.push(path.relative(ROOT, full).split(path.sep).join('/'));
  }
})(ROOT);
files.sort();

// 校验必须在写 zip 之前：失败时不覆盖上一次的合规包
let counts;
try {
  counts = validateFrontmatter(fs.readFileSync(path.join(ROOT, 'SKILL.md'), 'utf8'));
} catch (e) {
  console.error(`✗ frontmatter 校验失败：${e.message}`);
  process.exit(1);
}
console.log(`✓ frontmatter：examples_zh=${counts.examples_zh}, examples_en=${counts.examples_en}（上限 ${MAX_EXAMPLES}）`);
if (process.argv.includes('--check-only')) process.exit(0);

// CRC32
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const local = [];
const central = [];
let offset = 0;

for (const rel of files) {
  let data = fs.readFileSync(path.join(ROOT, rel));
  // README 进包时剔除引用 assets/ 的图片行（assets 不随包，避免裂图）；仓库与 GitHub 版不受影响
  if (rel === 'README.md') {
    const text = data.toString('utf8').replace(/!\[[^\]]*\]\(assets\/[^)]+\)\s*\n(\s*\n)?/g, '');
    data = Buffer.from(text, 'utf8');
  }
  const comp = zlib.deflateRawSync(data);
  const crc = crc32(data);
  const name = Buffer.from(rel, 'utf8');

  const lh = Buffer.alloc(30);
  lh.writeUInt32LE(0x04034b50, 0);
  lh.writeUInt16LE(20, 4);
  lh.writeUInt16LE(0x0800, 6);   // UTF-8 文件名
  lh.writeUInt16LE(8, 8);        // deflate
  lh.writeUInt16LE(0, 10);
  lh.writeUInt16LE(0, 12);
  lh.writeUInt32LE(crc, 14);
  lh.writeUInt32LE(comp.length, 18);
  lh.writeUInt32LE(data.length, 22);
  lh.writeUInt16LE(name.length, 26);
  lh.writeUInt16LE(0, 28);
  local.push(lh, name, comp);

  const ch = Buffer.alloc(46);
  ch.writeUInt32LE(0x02014b50, 0);
  ch.writeUInt16LE(20, 4);
  ch.writeUInt16LE(20, 6);
  ch.writeUInt16LE(0x0800, 8);
  ch.writeUInt16LE(8, 10);
  ch.writeUInt16LE(0, 12);
  ch.writeUInt16LE(0, 14);
  ch.writeUInt32LE(crc, 16);
  ch.writeUInt32LE(comp.length, 20);
  ch.writeUInt32LE(data.length, 24);
  ch.writeUInt16LE(name.length, 28);
  ch.writeUInt16LE(0, 30);
  ch.writeUInt16LE(0, 32);
  ch.writeUInt16LE(0, 34);
  ch.writeUInt16LE(0, 36);
  ch.writeUInt32LE(0, 38);
  ch.writeUInt32LE(offset, 42);
  central.push(ch, name);

  offset += 30 + name.length + comp.length;
}

const cd = Buffer.concat(central);
const eocd = Buffer.alloc(22);
eocd.writeUInt32LE(0x06054b50, 0);
eocd.writeUInt16LE(0, 4);
eocd.writeUInt16LE(0, 6);
eocd.writeUInt16LE(files.length, 8);
eocd.writeUInt16LE(files.length, 10);
eocd.writeUInt32LE(cd.length, 12);
eocd.writeUInt32LE(offset, 16);
eocd.writeUInt16LE(0, 20);

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT, Buffer.concat([...local, cd, eocd]));

const leaked = files.some(f => f === '.git' || f.startsWith('.git/') || f.startsWith('build/'));
console.log(`✓ ${path.relative(ROOT, OUT)}  (${files.length} files, ${fs.statSync(OUT).size} bytes)`);
console.log(leaked ? '  ⚠ 警告：压缩包含 .git 或 build/' : '  ✓ 未包含 .git / build / assets');
