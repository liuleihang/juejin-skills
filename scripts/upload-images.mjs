// 本地图片自动上传 + Markdown 改写：走掘金现行字节 ImageX 三段式链路（2026-10-23 Playwright 实测）
// 链路：gen_token(STS) → ApplyImageUpload(AWS SigV4 签名) → POST 直传 tos → CommitImageUpload → get_img_url(签名 URL)
// 用法（独立 CLI）：
//   node scripts/upload-images.mjs article.md               # 上传并输出 <name>.juejin.md
//   node scripts/upload-images.mjs article.md --in-place    # 原地改写（自动留 .bak 备份）
//   node scripts/upload-images.mjs article.md --dry-run     # 只扫描不联网
// 也可作为模块被 publish.mjs 引用（scanLocalImages / uploadAndRewrite）
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { isMain } from './is-main.mjs';
import {
  CFG, DEFAULT_HEADERS, loadCookies, cookiesToHeader, ensureSessionDir,
} from './config.mjs';

// ---------- 扫描：行内图片 ![alt](target)，跳过 http(s)/data: 引用 ----------
const IMG_RE = /(!\[[^\]\n]*\]\(\s*)([^)\s]+)((?:\s+"[^"]*")?\s*\))/g;

// 剔除代码区域（围栏代码块 + 行内代码段）：文档/文章里举例的 `![alt](path)` 不应被当作真实图片引用
function stripCodeRegions(md) {
  return md
    .replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, '') // fenced code block（``` 或 ~~~）
    .replace(/`[^`\n]*`/g, ''); // 行内代码段
}

export function scanLocalImages(md, baseDir) {
  const found = [];
  for (const m of stripCodeRegions(md).matchAll(IMG_RE)) {
    const target = m[2];
    if (/^(https?:)?\/\//i.test(target) || /^data:/i.test(target)) continue; // 远程/内联，跳过
    let abs;
    try { abs = path.resolve(baseDir, decodeURIComponent(target)); } catch { abs = path.resolve(baseDir, target); }
    const ext = path.extname(abs).toLowerCase();
    const allowed = CFG.imageUpload.allowedExt.includes(ext);
    const exists = fs.existsSync(abs) && fs.statSync(abs).isFile();
    const size = exists ? fs.statSync(abs).size : 0;
    const reason = !allowed ? `不支持的扩展名 ${ext || '(无)'}`
      : !exists ? '文件不存在'
      : size > CFG.imageUpload.maxSizeMb * 1024 * 1024 ? `超过 ${CFG.imageUpload.maxSizeMb}MiB 上限`
      : null;
    found.push({ match: m[0], prefix: m[1], target, suffix: m[3], abs, size, reason });
  }
  return found;
}

// ---------- AWS SigV4 签名（掘金 ImageX 实测格式：仅签 x-amz-date + x-amz-security-token） ----------
function sha256hex(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}
function hmacBuf(key, data) {
  return crypto.createHmac('sha256', key).update(data).digest();
}
function sigv4({ ak, sk, sessionToken, query, method = 'GET' }) {
  const cfg = CFG.imageUpload;
  const amzDate = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z'); // YYYYMMDDTHHMMSSZ
  const date = amzDate.slice(0, 8);
  const canonicalQuery = Object.entries(query)
    .map(([k, v]) => [k, encodeURIComponent(v)].join('='))
    .sort((a, b) => (a < b ? -1 : 1))
    .join('&');
  const signedHeaders = 'x-amz-date;x-amz-security-token';
  const canonicalRequest = [
    method, '/', canonicalQuery,
    `x-amz-date:${amzDate}\nx-amz-security-token:${sessionToken}\n`,
    signedHeaders, sha256hex(''),
  ].join('\n');
  const scope = `${date}/${cfg.region}/imagex/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonicalRequest)].join('\n');
  let key = hmacBuf('AWS4' + sk, date);
  key = hmacBuf(key, cfg.region);
  key = hmacBuf(key, 'imagex');
  key = hmacBuf(key, 'aws4_request');
  const signature = crypto.createHmac('sha256', key).update(stringToSign).digest('hex');
  return {
    amzDate,
    authorization: `AWS4-HMAC-SHA256 Credential=${ak}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

function randomUuid19() {
  // 19 位数字 uuid（与编辑器行为一致：gen_token / get_img_url 共用同一个）
  let s = String(Date.now());
  while (s.length < 19) s += Math.floor(Math.random() * 10);
  return s.slice(0, 19);
}

async function jsonFetch(url, { headers = {}, body = null, method = 'GET' } = {}) {
  const resp = await fetch(url, {
    method, headers, body,
    signal: AbortSignal.timeout(CFG.timeoutMs),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
  return resp.json();
}

// ---------- 上传单张：ImageX 三段式，返回编辑器同款签名 URL ----------
export async function uploadOne(absPath, cookie) {
  const cfg = CFG.imageUpload;
  const uuid = randomUuid19();
  const uaHeaders = { 'User-Agent': DEFAULT_HEADERS['User-Agent'], Cookie: cookie, Accept: 'application/json' };

  // ① STS 临时凭证
  const gt = await jsonFetch(`${cfg.genToken}?aid=${cfg.aid}&uuid=${uuid}&client=${cfg.client}`, { headers: uaHeaders });
  if (!gt || gt.err_no !== 0) throw new Error(`gen_token 失败：err_no=${gt && gt.err_no} err_msg=${gt && gt.err_msg}`);
  const t = gt.data.token;

  // ② ApplyImageUpload（SigV4 签名）
  const applyQuery = { Action: 'ApplyImageUpload', Version: '2018-08-01', ServiceId: cfg.serviceId };
  const signed = sigv4({ ak: t.AccessKeyId, sk: t.SecretAccessKey, sessionToken: t.SessionToken, query: applyQuery });
  const qs = Object.entries(applyQuery).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  const apply = await jsonFetch(`${cfg.imagexHost}/?${qs}`, {
    headers: {
      authorization: signed.authorization,
      'x-amz-date': signed.amzDate,
      'x-amz-security-token': t.SessionToken,
      'User-Agent': DEFAULT_HEADERS['User-Agent'],
    },
  });
  const addr = apply && apply.Result && apply.Result.UploadAddress;
  if (!addr || !addr.StoreInfos || !addr.StoreInfos.length) {
    throw new Error(`ApplyImageUpload 响应异常：${JSON.stringify(apply).slice(0, 200)}`);
  }
  const store = addr.StoreInfos[0];

  // ③ 直传文件体（uploadHost 优先从 SessionKey 内解析，失败用实测兜底值）
  let uploadHost = cfg.uploadHostFallback;
  try {
    const skj = JSON.parse(Buffer.from(addr.SessionKey, 'base64').toString('utf8'));
    if (skj.uploadHost) uploadHost = skj.uploadHost;
  } catch { /* 保持兜底 */ }
  const buf = fs.readFileSync(absPath);
  const crc32Hex = zlib.crc32(buf).toString(16).padStart(8, '0'); // 服务端校验 MismatchChecksum
  const up = await fetch(`https://${uploadHost}/${store.StoreUri}`, {
    method: 'POST',
    headers: {
      authorization: store.Auth,
      'Content-Type': 'application/octet-stream',
      'Content-CRC32': crc32Hex,
      'Content-Disposition': `attachment; filename="${path.basename(absPath).replace(/[^\w.\-]/g, '_')}"`,
    },
    body: buf,
    signal: AbortSignal.timeout(CFG.timeoutMs),
  });
  if (!up.ok) throw new Error(`文件直传失败：HTTP ${up.status} ${await up.text().then((s) => s.slice(0, 150)).catch(() => '')}`);

  // ④ CommitImageUpload（SigV4 签名；抓包实测为 POST）
  const commitQuery = { Action: 'CommitImageUpload', Version: '2018-08-01', SessionKey: addr.SessionKey, ServiceId: cfg.serviceId };
  const signedC = sigv4({ ak: t.AccessKeyId, sk: t.SecretAccessKey, sessionToken: t.SessionToken, query: commitQuery, method: 'POST' });
  const cqs = Object.entries(commitQuery).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  let commit = null;
  let lastCommitErr = null;
  for (let attempt = 1; attempt <= 2; attempt++) { // 后端偶发 bad gateway，重试一次
    commit = await jsonFetch(`${cfg.imagexHost}/?${cqs}`, {
      method: 'POST',
      headers: {
        authorization: signedC.authorization,
        'x-amz-date': signedC.amzDate,
        'x-amz-security-token': t.SessionToken,
        'User-Agent': DEFAULT_HEADERS['User-Agent'],
      },
      body: '',
    });
    const st = commit && commit.Result && commit.Result.Results && commit.Result.Results[0] && commit.Result.Results[0].UriStatus;
    if (st === 2000) { commit.__ok = true; break; }
    lastCommitErr = commit;
    if (attempt === 1) await new Promise((r) => setTimeout(r, 1200));
  }
  if (!commit || !commit.__ok) throw new Error(`CommitImageUpload 异常：原始响应=${JSON.stringify(lastCommitErr).slice(0, 300)}`);

  // ⑤ 换取编辑器同款签名 URL（正文引用；掘金渲染层动态重签）
  const gi = await jsonFetch(`${cfg.getImageUrl}?aid=${cfg.aid}&uuid=${uuid}&uri=${encodeURIComponent(store.StoreUri)}&img_type=${cfg.imgType}`, { headers: uaHeaders });
  if (!gi || gi.err_no !== 0) throw new Error(`get_img_url 失败：err_no=${gi && gi.err_no} err_msg=${gi && gi.err_msg}`);
  const url = gi.data && gi.data.main_url;
  if (!url) throw new Error(`get_img_url 响应中无 main_url：${JSON.stringify(gi.data).slice(0, 200)}`);
  return url;
}

// ---------- 上传并改写：逐张上传（间隔防频控），全部成功才返回改写结果 ----------
export async function uploadAndRewrite(md, baseDir, cookie, { log = console.log } = {}) {
  const images = scanLocalImages(md, baseDir);
  const uploadable = images.filter((im) => !im.reason);
  const blocked = images.filter((im) => im.reason);
  const uploaded = [];
  const mapping = new Map(); // target → CDN url（同名 target 复用一次上传结果）

  for (const im of uploadable) {
    if (mapping.has(im.target)) { uploaded.push({ ...im, url: mapping.get(im.target), reused: true }); continue; }
    log(`[upload] ${im.target}（${(im.size / 1024).toFixed(1)} KB）上传中…`);
    const url = await uploadOne(im.abs, cookie);
    log(`[upload] ✓ ${url}`);
    mapping.set(im.target, url);
    uploaded.push({ ...im, url });
    if (CFG.imageUpload.uploadGapMs > 0) await new Promise((r) => setTimeout(r, CFG.imageUpload.uploadGapMs));
  }

  let rewritten = md;
  for (const [target, url] of mapping) {
    rewritten = rewritten.replaceAll(target, url);
  }
  return { rewritten, images, uploaded, blocked };
}

// ---------- CLI 入口 ----------
async function main() {
  const argv = process.argv.slice(2);
  const file = argv.find((a) => !a.startsWith('--'));
  const inPlace = argv.includes('--in-place');
  const dryRun = argv.includes('--dry-run');
  if (!file) {
    console.error('用法：node scripts/upload-images.mjs <article.md> [--in-place] [--dry-run]');
    process.exit(1);
  }
  const abs = path.resolve(file);
  if (!/\.(md|markdown)$/i.test(abs)) throw new Error('仅支持 .md / .markdown 文件');
  if (abs.length > 260) throw new Error('路径过长');
  const md = fs.readFileSync(abs, 'utf8');
  const baseDir = path.dirname(abs);

  const images = scanLocalImages(md, baseDir);
  if (!images.length) {
    console.log('[upload] 未发现本地图片引用，无需上传。');
    return;
  }
  console.log(`[upload] 扫描到 ${images.length} 个本地图片引用：`);
  for (const im of images) {
    const status = im.reason ? `✗ ${im.reason}` : `${(im.size / 1024).toFixed(1)} KB`;
    console.log(`  - ${im.target} → ${im.abs}（${status}）`);
  }
  if (dryRun) {
    console.log('[upload] --dry-run：未发起网络请求。');
    return;
  }

  const bad = images.filter((im) => im.reason);
  if (bad.length) throw new Error(`存在 ${bad.length} 个无法上传的图片引用（见上表），请先修正 md 再上传`);

  ensureSessionDir();
  const cookies = loadCookies();
  if (!cookies.length) throw new Error('未找到会话，请先运行：node scripts/login.mjs');

  const { rewritten, uploaded } = await uploadAndRewrite(md, baseDir, cookiesToHeader(cookies));

  if (inPlace) {
    fs.copyFileSync(abs, abs + '.bak');
    fs.writeFileSync(abs, rewritten, 'utf8');
    console.log(`[upload] 已原地改写 ${abs}（备份：${abs}.bak）`);
  } else {
    const out = abs.replace(/\.(md|markdown)$/i, '') + '.juejin.md';
    fs.writeFileSync(out, rewritten, 'utf8');
    console.log(`[upload] 改写结果已写入：${out}`);
  }
  console.log(`[upload] 完成：${uploaded.length} 张图片已上传为掘金 CDN 链接。`);
}

// 仅直接运行时执行 CLI（被 import 时不触发）
if (isMain(import.meta.url)) main().catch((err) => {
  console.error('[upload] 失败：', err.message);
  process.exit(1);
});
