// 分类/标签查询：拉取掘金分类列表与标签，缓存到 ~/.juejin/tag-ids.json
// 用法：node scripts/tags.mjs [分类名称关键字]          # CLI 运行永远全量刷新
// 查询发布用的 id：node scripts/tags.mjs 前端
// 供 publish.mjs 复用：refreshTagCache()（强制重建缓存）/ loadTagCache()（带过期自动刷新）
import { api, cookiesToHeader, loadCookies, TAG_CACHE_FILE, ensureSessionDir } from './config.mjs';
import fs from 'node:fs';
import { isMain } from './is-main.mjs';

const CATEGORY_BRIEFS_URL = 'https://api.juejin.cn/tag_api/v1/query_category_briefs';
const TAG_LIST_URL = 'https://api.juejin.cn/tag_api/v1/query_tag_list';
const GAP_MS = 300; // 翻页间隔（防频控）

// ---------- 强制全量重建缓存（CLI 主流程 & 过期/未命中自愈共用） ----------
export async function refreshTagCache(cookie) {
  cookie = cookie || cookiesToHeader(loadCookies());

  // 分类列表：GET 优先，失败降级 POST（端点方法以抓包为准，此处双保险）
  let briefs;
  try {
    briefs = await api(CATEGORY_BRIEFS_URL, { cookie });
  } catch {
    briefs = await api(CATEGORY_BRIEFS_URL, { method: 'POST', body: {}, cookie });
  }
  if (!briefs || briefs.err_no !== 0) {
    throw new Error(`分类列表获取失败：err_no=${briefs && briefs.err_no} err_msg=${briefs && briefs.err_msg}`);
  }
  const categories = (briefs.data || []).map((c) => ({ id: c.category_id || c.id, name: c.category_name || c.name }));
  console.log(`[tags] 共 ${categories.length} 个分类：`);
  for (const c of categories) console.log(`  ${c.id}  ${c.name}`);

  // 拉取标签列表（2026-10-23 实测：query_tag_list 的 cate_id 实际不过滤，返回全局标签表）
  // 因此改为全量翻页拉取，去重后存入 tagsAll；tagsByCategory 保留结构兼容旧缓存消费方
  // 现行端点：POST /tag_api/v1/query_tag_list（旧 query_category_tags 已下线，返回「请求路由不存在」）
  // 返回 data 为数组，元素形如 { tag_id, tag: { tag_id, tag_name, ... } }
  const tagsByCategory = {};
  const seenTags = new Map();
  for (const c of categories) {
    const t = await api(TAG_LIST_URL, {
      method: 'POST',
      body: { cate_id: c.id, cursor: '0', limit: 100 },
      cookie,
    });
    if (t && t.err_no === 0) {
      tagsByCategory[c.id] = (t.data || []).map((x) => ({
        id: x.tag_id || (x.tag && x.tag.tag_id) || x.id,
        name: (x.tag && x.tag.tag_name) || x.tag_name || x.name,
      }));
    }
    await new Promise((r) => setTimeout(r, GAP_MS));
  }

  // 全量翻页（最多 10 页 × 100，防失控）
  for (let cur = 0; cur < 1000; cur += 100) {
    const t = await api(TAG_LIST_URL, {
      method: 'POST',
      body: { cursor: String(cur), limit: 100 },
      cookie,
    });
    const list = t && t.err_no === 0 && Array.isArray(t.data) ? t.data : [];
    if (!list.length) break;
    for (const x of list) {
      const id = x.tag_id || (x.tag && x.tag.tag_id);
      const name = (x.tag && x.tag.tag_name) || x.tag_name;
      if (id && name && !seenTags.has(id)) seenTags.set(id, { id, name });
    }
    await new Promise((r) => setTimeout(r, GAP_MS));
  }
  const tagsAll = [...seenTags.values()];
  console.log(`[tags] 全量去重标签 ${tagsAll.length} 个`);

  const cache = { fetchedAt: new Date().toISOString(), categories, tagsByCategory, tagsAll };
  fs.writeFileSync(TAG_CACHE_FILE, JSON.stringify(cache, null, 2), 'utf8');
  console.log(`[tags] 缓存已写入 ${TAG_CACHE_FILE}`);
  return cache;
}

// ---------- 带过期自动刷新的缓存加载（publish.mjs 消费） ----------
// 优先读缓存；fetchedAt 距今超过 maxAgeMs（或缺缓存）时自动全量刷新一次。
// allowRefresh=false（如 --dry-run）时绝不联网，缺缓存返回空结构。
export async function loadTagCache({ cookie, maxAgeMs = 7 * 24 * 3600 * 1000, forceRefresh = false, allowRefresh = true } = {}) {
  ensureSessionDir();
  let cache = null;
  try { cache = JSON.parse(fs.readFileSync(TAG_CACHE_FILE, 'utf8')); } catch { /* 首次使用未拉缓存 */ }
  const age = cache && cache.fetchedAt ? Date.now() - Date.parse(cache.fetchedAt) : Infinity;
  const stale = age >= maxAgeMs;
  if (forceRefresh || (allowRefresh && stale)) {
    console.log(`[tags] 缓存${cache && cache.fetchedAt ? `已 ${Math.floor(age / 86400000)} 天前拉取` : '不存在'}，开始全量刷新…`);
    cache = await refreshTagCache(cookie);
  }
  return cache || { fetchedAt: null, categories: [], tagsByCategory: {}, tagsAll: [] };
}

// ---------- CLI 入口（永远全量刷新，保证手动跑一次就是最新） ----------
async function main() {
  const cache = await loadTagCache({ forceRefresh: true });

  const kw = process.argv[2];
  if (!kw) return;
  const cat = cache.categories.find((c) => c.name === kw || c.name.includes(kw));
  if (cat) {
    console.log(`\n分类「${cat.name}」(${cat.id}) 下的常用标签：`);
    for (const t of (cache.tagsByCategory[cat.id] || []).slice(0, 30)) console.log(`  ${t.id}  ${t.name}`);
  }
  const hits = cache.tagsAll.filter((t) => t.name.toLowerCase().includes(kw.toLowerCase())).slice(0, 30);
  if (hits.length) {
    console.log(`\n全量标签中名称含「${kw}」的：`);
    for (const t of hits) console.log(`  ${t.id}  ${t.name}`);
  } else if (!cat) {
    console.error(`[tags] 未找到名称含「${kw}」的分类或标签`);
  }
}

// 仅当作为 CLI 直接运行时才执行 main（被 publish.mjs import 时绝不触发）
if (isMain(import.meta.url)) {
  main().catch((err) => {
    console.error('[tags] 请求失败：', err.message);
    process.exit(1);
  });
}
