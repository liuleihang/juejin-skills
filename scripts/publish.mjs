// 发布主流程：Markdown（含 frontmatter）→ 本地图片自动上传改写 → 创建草稿（默认）→ 公开发布（双标志互锁）
// 用法：
//   node scripts/publish.mjs article.md                       # 只建草稿（默认，最安全）
//   node scripts/publish.mjs article.md --publish --yes       # 公开发布（必须双标志同时给出）
// 可选参数：--brief "摘要" --category 前端 --tag "Vue.js,前端" --cover <url> --dry-run --no-upload
// 优先级：CLI 参数 > 文章 frontmatter > config 默认值（~/.juejin/config.json）
import fs from 'node:fs';
import path from 'node:path';
import {
  api, cookiesToHeader, loadCookies, ensureSessionDir,
  ENDPOINTS, CFG,
} from './config.mjs';
import { scanLocalImages, uploadAndRewrite } from './upload-images.mjs';
import { loadTagCache } from './tags.mjs';

const MAX_MD_SIZE = 2 * 1024 * 1024; // 2 MiB，防御异常大文件

// ---------- 参数解析 ----------
function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--publish') args.publish = true;
    else if (a === '--yes') args.yes = true;
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--brief') args.brief = argv[++i];
    else if (a === '--category') args.category = argv[++i];
    else if (a === '--cover') args.cover = argv[++i];
    else if (a === '--tag') args.tags = (args.tags || []).concat(String(argv[++i]).split(','));
    else if (a === '--no-upload') args.noUpload = true; // 跳过本地图片自动上传
    else args._.push(a);
  }
  return args;
}

// ---------- frontmatter 解析（支持 title/brief/category/tags/cover） ----------
function parseFrontmatter(md) {
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

// ---------- 摘要：50-100 字硬性要求（上下限读 config），自动从正文收集 ----------
function buildBrief(meta, args, body) {
  const min = CFG.defaults.briefMin;
  const max = CFG.defaults.briefMax;
  let brief = args.brief || meta.brief || meta.brief_content || meta.description || '';
  brief = brief.trim();
  if (brief.length < min) {
    // 从正文补齐：去掉 Markdown 符号，按段落收集到下限
    const plain = body
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/[#>*`|\-[\]()!]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    brief = (brief + ' ' + plain).trim().slice(0, max);
  }
  if (brief.length > max) brief = brief.slice(0, max);
  return brief;
}

// ---------- id 解析：名称 → 缓存的 id ----------
function resolveIds(name, list, kind) {
  const hit = list.find((x) => x.name === name) || list.find((x) => x.name.includes(name));
  if (!hit) {
    throw new Error(`未在缓存中找到${kind}「${name}」。请先运行：node scripts/tags.mjs 查看可用名称，或更新缓存`);
  }
  return hit.id;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const file = args._[0];
  if (!file) {
    console.error('用法：node scripts/publish.mjs <article.md> [--publish --yes] [--brief 摘要] [--category 前端] [--tag "A,B"] [--cover url] [--dry-run] [--no-upload]');
    process.exit(1);
  }

  // 文件读取安全约束：仅 .md/.markdown、大小 <= 2MiB
  const abs = path.resolve(file);
  if (!/\.(md|markdown)$/i.test(abs)) throw new Error('仅支持 .md / .markdown 文件');
  const stat = fs.statSync(abs);
  if (stat.size > MAX_MD_SIZE) throw new Error(`文件超过 2MiB（${stat.size} 字节），请拆分后发布`);
  const md = fs.readFileSync(abs, 'utf8');

  const { meta, body } = parseFrontmatter(md);

  // 标题：CLI/frontmatter 均未提供时取正文首个一级标题
  let title = args._[1] || meta.title || '';
  if (!title) {
    const h1 = /^#\s+(.+)$/m.exec(body);
    title = h1 ? h1[1].trim() : '';
  }
  if (!title) throw new Error('缺少标题：请在 frontmatter 提供 title，或正文包含 # 一级标题');

  const brief = buildBrief(meta, args, body);
  console.log(`[publish] 标题：${title}`);
  console.log(`[publish] 摘要（${brief.length} 字）：${brief}`);
  if (brief.length < CFG.defaults.briefMin) {
    console.warn(`[publish] ⚠️ 摘要不足 ${CFG.defaults.briefMin} 字，掘金接口可能拒绝；建议用 --brief 显式提供 ${CFG.defaults.briefMin}-${CFG.defaults.briefMax} 字摘要`);
  }

  // 分类/标签 id 解析（缓存超期自动刷新；未命中强制刷新自愈一次，仍失败才报错）
  ensureSessionDir();
  const maxAgeMs = ((CFG.tagCache && CFG.tagCache.maxAgeDays) || 7) * 24 * 3600 * 1000;
  const refreshOpts = { cookie: cookiesToHeader(loadCookies()), maxAgeMs, allowRefresh: !args.dryRun }; // --dry-run 绝不联网刷缓存
  let cache = await loadTagCache(refreshOpts);
  const categoryName = args.category || meta.category || CFG.defaults.category;
  const findCat = (c) => c.categories.find((x) => x.name === categoryName || x.name.includes(categoryName));
  let cat = findCat(cache);
  if (!cat && refreshOpts.allowRefresh) {
    console.log(`[publish] 分类「${categoryName}」未命中缓存，强制刷新后重试…`);
    cache = await loadTagCache({ ...refreshOpts, forceRefresh: true });
    cat = findCat(cache);
  }
  if (!cat && !args.dryRun) {
    throw new Error(`未找到分类「${categoryName}」。请运行：node scripts/tags.mjs 查看全部分类，并核对分类名称`);
  }
  const tagNames = args.tags || (meta.tags ? String(meta.tags).split(',') : []);
  const pickTagList = (c) => c.tagsByCategory[cat ? cat.id : ''] || [];
  const tagIds = [];
  for (const n of tagNames.filter(Boolean)) {
    const name = n.trim();
    try {
      tagIds.push(resolveIds(name, pickTagList(cache), '标签'));
    } catch {
      try {
        tagIds.push(resolveIds(name, cache.tagsAll || [], '标签（全量兜底）')); // 全量标签表兜底
      } catch {
        if (!refreshOpts.allowRefresh) throw new Error(`未找到标签「${name}」（--dry-run 不联网刷新缓存）`);
        console.log(`[publish] 标签「${name}」未命中缓存，强制刷新后重试…`);
        cache = await loadTagCache({ ...refreshOpts, forceRefresh: true });
        cat = cat || findCat(cache);
        tagIds.push(resolveIds(name, pickTagList(cache), '标签')); // 刷新后仍查不到，让 resolveIds 抛出原始错误
      }
    }
  }

  // 本地图片处理：默认自动上传到掘金图床并改写为 CDN 链接（--no-upload 跳过）
  let finalBody = body.trim();
  const locals = scanLocalImages(md, path.dirname(abs));
  if (locals.length && !args.noUpload) {
    console.log(`[publish] 发现 ${locals.length} 个本地图片引用`);
    if (args.dryRun) {
      for (const im of locals) {
        console.log(`  - ${im.target} → ${im.abs}${im.reason ? `（✗ ${im.reason}）` : `（${(im.size / 1024).toFixed(1)} KB）`}`);
      }
      console.log('[publish] --dry-run：真实运行时将先上传图片并改写为 CDN 链接');
    } else {
      const cookies = loadCookies();
      if (!cookies.length) throw new Error('检测到本地图片，需先登录：node scripts/login.mjs（或加 --no-upload 跳过上传）');
      const { rewritten, uploaded, blocked } = await uploadAndRewrite(md, path.dirname(abs), cookiesToHeader(cookies));
      if (blocked.length) {
        for (const b of blocked) console.error(`[publish] ✗ 无法上传 ${b.target}：${b.reason}`);
        throw new Error('存在无法上传的图片引用，已中止发布（避免发出死链文章）；修正后重试，或用 --no-upload 强行跳过');
      }
      // 图片替换只应影响正文：从改写后的完整 md 中剥离 frontmatter
      const m = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(rewritten);
      finalBody = (m ? rewritten.slice(m[0].length) : rewritten).trim();
      console.log(`[publish] ${uploaded.length} 张图片已上传并改写为 CDN 链接`);
    }
  }

  const payload = {
    category_id: cat ? cat.id : '<dry-run>',
    tag_ids: tagIds,
    link_url: '',
    cover_image: args.cover || meta.cover || '',
    title,
    brief_content: brief,
    edit_type: 10, // 10 = Markdown 编辑器
    html_content: 'deprecated',
    mark_content: finalBody,
    theme_ids: [],
  };

  if (args.dryRun) {
    console.log('[publish] --dry-run：以下为将提交的请求体（未发起网络请求）：');
    payload.mark_content = payload.mark_content.slice(0, 200) + ` ...(共 ${finalBody.length} 字符)`;
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  const cookies = loadCookies();
  if (!cookies.length) throw new Error(`未找到会话，请先运行：node scripts/login.mjs`);
  const cookie = cookiesToHeader(cookies);

  // 第 1 步：创建草稿
  const draft = await api(ENDPOINTS.draftCreate, {
    method: 'POST', body: payload, cookie,
  });
  if (!draft || draft.err_no !== 0) {
    console.error(`[publish] 草稿创建失败：err_no=${draft && draft.err_no} err_msg=${draft && draft.err_msg}`);
    process.exit(2);
  }
  const draftId = draft.data && draft.data.id;
  console.log(`[publish] 草稿已创建：draft_id=${draftId}`);
  console.log(`[publish] 可在网页端查看：https://juejin.cn/editor/drafts/${draftId}`);

  // 第 2 步：公开发布（双标志互锁，缺一即止于草稿）
  const publishPublicly = args.publish === true && args.yes === true;
  if (!publishPublicly) {
    console.log('[publish] 已止步于草稿（默认安全策略）。确认无误后加 --publish --yes 公开发布。');
    return;
  }

  const pub = await api(ENDPOINTS.articlePublish, {
    method: 'POST',
    body: {
      draft_id: draftId,
      sync_to_org: false,
      column_ids: [],
      theme_ids: [],
      encrypted_word_count: 0,
      category_id: payload.category_id,
      tag_ids: payload.tag_ids,
      cover_image: payload.cover_image,
      brief_content: payload.brief_content,
    },
    cookie,
  });
  if (!pub || pub.err_no !== 0) {
    console.error(`[publish] 发布失败（草稿仍在，可网页端手动发）：err_no=${pub && pub.err_no} err_msg=${pub && pub.err_msg}`);
    process.exit(3);
  }
  const articleId = (pub.data && (pub.data.article_id || pub.data.id)) || draftId;
  console.log(`[publish] 🎉 发布成功：https://juejin.cn/post/${articleId}`);
}

main().catch((err) => {
  console.error('[publish] 失败：', err.message);
  process.exit(1);
});
