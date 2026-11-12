// juejin-skills 共享配置：公共路径与参数全部集中于此
// 用户级覆盖：~/.juejin/config.json（浅合并，两层深；该文件路径固定，不随覆盖变化）
// 会话凭据存放在会话目录（默认 ~/.juejin/，可经 sessionDirName 调整），绝不入库、绝不打印完整值
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

export const JUEJIN_WEB_URL = 'https://juejin.cn';

// ---------- 默认配置（唯一真相源） ----------
const DEFAULTS = {
  apiBase: 'https://api.juejin.cn',
  timeoutMs: 30_000,        // 所有请求超时
  retryBackoffMs: 1_500,    // 网络错误重试前的退避
  sessionDirName: '.juejin', // 会话目录名（相对 HOME；给绝对路径则直接使用）
  defaults: {
    category: '前端',        // 未指定分类时的兜底
    briefMin: 50,            // 掘金摘要硬性下限
    briefMax: 100,           // 掘金摘要硬性上限
  },
  tagCache: {
    maxAgeDays: 7,           // 标签缓存最长有效期；超期或解析失败时自动刷新一次再兜底报错
  },
  hot: {
    type: 'hot',             // hot=热门；new 待实机复核，暂不作能力承诺
    defaultLimit: 20,        // 默认展示条数
    maxLimit: 50,            // 综合榜单次最多返回 50 条，防误设超限
  },
  frontmatter: {
    // 文章 frontmatter 规范字段（与 hone-blog 统一）：key 为权威名，aliases 为兼容别名。
    // 用户可在 ~/.juejin/config.json 整体替换 required 数组，自定义必填项/别名/建议文案。
    enabled: true,           // false = publish.mjs 不再输出检查报告
    strict: false,           // true = 缺失即中止发布（exit 2）；false = 仅提示
    required: [
      { key: 'title', label: '标题', aliases: ['name', 'headline'], publish: true,
        suggestion: '缺失时脚本会取正文首个 # 一级标题；建议显式给出，避免与 H1 不一致',
        example: 'title: 文章标题' },
      { key: 'date', label: '时间', aliases: ['created', 'created_at', 'publish_date'], publish: false,
        suggestion: '建议用 YYYY-MM-DD；仅作本地归档/写作规范，掘金发布接口不使用该字段',
        example: 'date: YYYY-MM-DD' },
      { key: 'description', label: '摘要', aliases: ['summary', 'brief', 'brief_content', 'abstract', 'excerpt'], publish: true,
        suggestion: '掘金要求摘要 50–100 字；summary / brief 均为兼容别名',
        example: 'description: 一句话概括本文，50–100 字' },
      { key: 'category', label: '分类', aliases: ['cate', 'categories'], publish: true,
        suggestion: '须是掘金分类缓存中存在的名称，如 前端 / 后端 / 人工智能',
        example: 'category: 前端' },
      { key: 'tags', label: '标签', aliases: ['tag', 'keywords'], publish: true,
        suggestion: 'YAML 数组 [a, b] 或逗号串 a,b 均可，须是掘金已有标签',
        example: 'tags: [AI编程, Node.js]' },
    ],
  },
  imageUpload: {
    // 2026-10-23 Playwright 实测：字节 ImageX 三段式上传链路（旧单接口 images_upload/v1/create 已下线）
    genToken: 'https://api.juejin.cn/imagex/v2/gen_token',
    getImageUrl: 'https://api.juejin.cn/imagex/v2/get_img_url',
    imagexHost: 'https://imagex.bytedanceapi.com',
    aid: '2608',
    client: 'web',
    serviceId: '73owjymdk6',
    region: 'cn-north-1',
    uploadHostFallback: 'tos-d-x-hl.snssdk.com',
    imgType: 'private', // 编辑器同款；正文引用由掘金渲染层动态重签
    maxSizeMb: 5,
    allowedExt: ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp'],
    uploadGapMs: 300,        // 多图连续上传的间隔（防频控）
  },
};

// ---------- 用户级覆盖加载（固定位于 ~/.juejin/config.json） ----------
export const USER_CONFIG_FILE = path.join(os.homedir(), DEFAULTS.sessionDirName, 'config.json');

function loadUserConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(USER_CONFIG_FILE, 'utf8'));
    const merged = { ...DEFAULTS, ...raw };
    merged.defaults = { ...DEFAULTS.defaults, ...(raw.defaults || {}) };
    merged.imageUpload = { ...DEFAULTS.imageUpload, ...(raw.imageUpload || {}) };
    merged.tagCache = { ...DEFAULTS.tagCache, ...(raw.tagCache || {}) };
    merged.hot = { ...DEFAULTS.hot, ...(raw.hot || {}) };
    merged.frontmatter = { ...DEFAULTS.frontmatter, ...(raw.frontmatter || {}) };
    return merged;
  } catch {
    return DEFAULTS; // 无配置文件时使用默认值
  }
}

export const CFG = loadUserConfig();
export const API_BASE = CFG.apiBase;

export const ENDPOINTS = {
  draftCreate: `${API_BASE}/content_api/v1/article_draft/create`,
  articlePublish: `${API_BASE}/content_api/v1/article/publish`,
  userGet: `${API_BASE}/user_api/v1/user/get`,
  categoryBriefs: `${API_BASE}/tag_api/v1/query_category_briefs`,
  tagList: `${API_BASE}/tag_api/v1/query_tag_list`, // 2026-10-23 实测：旧 query_category_tags 已下线
  articleRank: `${API_BASE}/content_api/v1/content/article_rank`, // 2026-11-11 实机核实：公开 GET，无需 Cookie
};

// 部分端点对 UA 敏感，伪装成常规浏览器请求
export const DEFAULT_HEADERS = {
  'Content-Type': 'application/json',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Accept: 'application/json',
};

// ---------- 会话目录（可经 sessionDirName 覆盖） ----------
export const SESSION_DIR = path.isAbsolute(CFG.sessionDirName)
  ? CFG.sessionDirName
  : path.join(os.homedir(), CFG.sessionDirName);
export const COOKIE_FILE = path.join(SESSION_DIR, 'session.json'); // Playwright cookies 数组
export const TAG_CACHE_FILE = path.join(SESSION_DIR, 'tag-ids.json');

export function ensureSessionDir() {
  fs.mkdirSync(SESSION_DIR, { recursive: true });
}

// Cookie 数组 → Cookie 请求头字符串
export function cookiesToHeader(cookies) {
  return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}

export function loadCookies() {
  try {
    const data = JSON.parse(fs.readFileSync(COOKIE_FILE, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

// 统一 JSON HTTP 封装：可配置超时、网络错误重试 1 次、业务错误原样返回给调用方判断
export async function api(url, { method = 'GET', body = null, cookie = '' } = {}) {
  const headers = { ...DEFAULT_HEADERS };
  if (cookie) headers.Cookie = cookie;
  let lastErr = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const resp = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(CFG.timeoutMs),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
      return await resp.json();
    } catch (err) {
      lastErr = err;
      const biz = err && err.type === 'http business';
      if (attempt === 1 && !biz) await new Promise((r) => setTimeout(r, CFG.retryBackoffMs));
      else break;
    }
  }
  throw lastErr;
}

// ---------- multipart/签名等上传底层见 upload-images.mjs（ImageX 三段式，2026-10-23 实测） ----------
