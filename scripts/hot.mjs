// 掘金热榜：拉取最近最火的文章（公开接口，无需登录）
// 用法：
//   node scripts/hot.mjs                          # 综合热榜，默认 20 条
//   node scripts/hot.mjs 前端                     # 位置参数指定分类
//   node scripts/hot.mjs --category 前端 --limit 10
//   node scripts/hot.mjs --json                    # JSON 输出（供 Agent / 管道消费）
//   node scripts/hot.mjs --categories             # 列出可用分类
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { api, CFG, ENDPOINTS } from './config.mjs';

const GENERAL_ID = '1'; // 综合榜约定值，不在 query_category_briefs 返回列表中
const POST_BASE = 'https://juejin.cn/post/';

function parseArgs(argv) {
  const args = { category: null, type: CFG.hot.type, limit: CFG.hot.defaultLimit, json: false, categories: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') args.json = true;
    else if (a === '--categories') args.categories = true;
    else if (a === '--category') args.category = argv[++i];
    else if (a === '--type') args.type = argv[++i];
    else if (a === '--limit') args.limit = Number(argv[++i]);
    else if (!a.startsWith('-') && !args.category) args.category = a;
    else throw new Error(`未知参数：${a}`);
  }
  if (!['hot', 'new'].includes(args.type)) throw new Error(`--type 仅支持 hot / new，收到：${args.type}`);
  const n = Number(args.limit);
  if (!Number.isInteger(n) || n < 1 || n > CFG.hot.maxLimit) {
    throw new Error(`--limit 必须是 1-${CFG.hot.maxLimit} 的整数，收到：${args.limit}`);
  }
  args.limit = n;
  return args;
}

// GET 优先、失败降级 POST，与 tags.mjs 的分类列表双保险保持一致
async function fetchCategories() {
  let r;
  try { r = await api(ENDPOINTS.categoryBriefs); }
  catch { r = await api(ENDPOINTS.categoryBriefs, { method: 'POST', body: {} }); }
  if (!r || r.err_no !== 0) {
    throw new Error(`分类列表获取失败：err_no=${r && r.err_no} err_msg=${r && r.err_msg}`);
  }
  return (r.data || []).map((c) => ({
    id: String(c.category_id || c.id || ''),
    name: c.category_name || c.name || '(未命名)',
  }));
}

function resolveCategory(cats, name) {
  if (!name || ['综合', '全部', 'all'].includes(name)) return { id: GENERAL_ID, name: '综合' };
  const hit = cats.find((c) => c.name === name)
    || cats.find((c) => c.name.toLowerCase().includes(name.toLowerCase()));
  if (!hit) throw new Error(`未找到分类「${name}」，可用：综合、${cats.map((c) => c.name).join('、')}`);
  return hit;
}

// 2026-11-11 实机核实：公开 GET，不传 Cookie
// data[] = { author:{name}, content:{content_id,title}, content_counter:{hot_rank,view,like,collect,comment_count} }
export async function fetchHotList({ categoryId, type, limit } = {}) {
  const params = new URLSearchParams({
    category_id: categoryId || GENERAL_ID,
    type: type || 'hot',
    aid: '2608',
    spider: '0',
  });
  const r = await api(`${ENDPOINTS.articleRank}?${params}`);
  if (!r || r.err_no !== 0) {
    throw new Error(`热榜获取失败：err_no=${r && r.err_no} err_msg=${r && r.err_msg}（非官方接口，可能已变更）`);
  }
  const list = Array.isArray(r.data) ? r.data : [];
  return list.slice(0, limit || CFG.hot.maxLimit).map((x, i) => {
    const c = x.content || {};
    const cc = x.content_counter || {};
    return {
      rank: i + 1,
      title: c.title || '(无标题)',
      author: (x.author && x.author.name) || '(未知)',
      articleId: String(c.content_id || ''),
      url: c.content_id ? `${POST_BASE}${c.content_id}` : '',
      hotRank: cc.hot_rank ?? 0,
      view: cc.view ?? 0,
      like: cc.like ?? 0,
      collect: cc.collect ?? 0,
      comment: cc.comment_count ?? 0,
    };
  });
}

function formatText(items, meta) {
  const lines = [`掘金热榜 · ${meta.name} · ${meta.type === 'hot' ? '热门' : '最新'} · ${items.length} 条`];
  for (const it of items) {
    lines.push(`${String(it.rank).padStart(2, ' ')}. ${it.title}`);
    lines.push(`    ${it.author}  热度${it.hotRank} 浏览${it.view} 点赞${it.like} 收藏${it.collect} 评论${it.comment}`);
    lines.push(`    ${it.url}`);
  }
  return lines.join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cats = await fetchCategories();
  if (args.categories) {
    console.log('可用分类（综合 = category_id 1）：');
    for (const c of cats) console.log(`  ${c.id}  ${c.name}`);
    return;
  }
  const cat = resolveCategory(cats, args.category);
  const items = await fetchHotList({ categoryId: cat.id, type: args.type, limit: args.limit });
  if (!items.length) {
    console.error('[hot] 热榜返回为空，可能接口变更或被限流；请原样上报 err_no。');
    process.exit(2);
  }
  console.log(args.json
    ? JSON.stringify({ category: cat.name, categoryId: cat.id, type: args.type, fetchedAt: new Date().toISOString(), items }, null, 2)
    : formatText(items, { name: cat.name, type: args.type }));
}

// 被 import 时不触发 CLI（同 tags.mjs 的 isMain 守卫）
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err) => {
    console.error('[hot] 请求失败：', err.message);
    console.error('非官方接口可能变更；若持续失败请抓包核对端点。');
    process.exit(1);
  });
}
