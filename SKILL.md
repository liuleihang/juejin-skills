---
name: juejin-skills
display_name: 掘金社区技能包
display_name_en: Juejin Community Skill Pack
description: 掘金社区技能包集合。功能点：文章发布（本地 Markdown 一键发布/存草稿、本地图片自动上传掘金图床、分类/标签查询）、掘金热榜（最近最火的文章，支持综合/分类筛选与条数控制）；后续会增加：沸点、签到、文章下载等功能。当用户要发布文章到掘金、存掘金草稿、上传配图到掘金图床、登录掘金账号、查询掘金分类标签、查看掘金热榜或热门文章时使用。
description_zh: 掘金社区技能包集合。当前包含文章发布：本地 Markdown 一键发布/存草稿、本地图片自动上传掘金图床、分类/标签查询、草稿优先双标志防误发；以及掘金热榜：公开只读，拉取最近最火的文章，支持分类筛选与条数控制。后续会增加沸点、签到、文章下载等功能。
description_en: "A collection of Juejin (juejin.cn) community skills. Currently includes article publishing: one-click publish/draft from local Markdown, automatic local-image upload to Juejin CDN, category/tag lookup, and draft-first publishing with double confirmation; and the Juejin hot list: public read-only, fetch the most popular articles with category filter and limit. More features such as Boiling Points, check-in and article download are coming soon."
allowed-tools: Bash
version: 1.4.0
author: Hone
examples_zh:
  - "把 ./article.md 存为掘金草稿，分类前端，标签 Vue.js"
  - "把这篇文章里的本地图片上传到掘金图床"
  - "看看今天掘金热榜前 10 篇文章"
examples_en:
  - "Save ./article.md as a Juejin draft, category 前端, tags Vue.js"
  - "Upload the local images in this article to Juejin image host"
  - "Show me today's top 10 Juejin hot articles"
agent_created: true
---

# Juejin Skills — 掘金社区技能包

当前包含**文章发布**与**掘金热榜**：将 Markdown 文章发布到掘金（juejin.cn），或拉取掘金最近最火的文章。掘金无官方公开 API，本 skill 通过社区抓包核实的 Web 接口实现；发文需 Cookie 鉴权并采用**草稿优先**安全策略，热榜为公开只读接口、无需登录。后续会增加沸点、签到、文章下载等功能。

> 本项目为社区工具，与掘金官方无关。

## 前置条件

- Node ≥ 18（原生 fetch，发布脚本零依赖）；
- `login.mjs` 需要 playwright 包与 Chromium（登录时引导安装）；
- Windows / macOS / Linux 均可（脚本纯 Node API 跨平台）；
- 会话凭据存于会话目录 `~/.juejin/session.json`（仓库外），**绝不入库、绝不打印完整值**。
- **执行方式**：本技能所有命令均由 Agent 通过 `Bash` 工具运行 `node scripts/<脚本>.mjs ...`；运行环境需 Node ≥ 18。

## 配置（可选）

公共路径与参数集中在 `scripts/config.mjs` 的 `DEFAULTS`，用户可在 `~/.juejin/config.json` 覆盖（无需改代码，两层浅合并）：

```json
{
  "timeoutMs": 30000,
  "sessionDirName": ".juejin",
  "defaults": { "category": "前端", "briefMin": 50, "briefMax": 100 },
  "imageUpload": { "maxSizeMb": 5, "uploadGapMs": 300 },
  "frontmatter": { "enabled": true, "strict": false }
}
```

**frontmatter 检查规则可自定义**：`frontmatter.required` 默认校验 `title / date / description / category / tags` 五项，缺失时打印建议、兼容别名与可粘贴片段，**只提示、不改写用户文章**。整体替换该数组即可增删字段、改权威名或改别名（下例把摘要权威名换回 `summary`）：

```json
{
  "frontmatter": {
    "enabled": true,
    "strict": false,
    "required": [
      { "key": "title", "label": "标题", "aliases": ["name"], "publish": true, "suggestion": "必填", "example": "title: 标题" },
      { "key": "summary", "label": "摘要", "aliases": ["description", "brief"], "publish": true, "suggestion": "50–100 字", "example": "summary: 一句话概括" }
    ]
  }
}
```

> `imageUpload` 的可覆盖项只有 `maxSizeMb` / `uploadGapMs` 等运行时参数；上传端点与签名常量写在 `config.mjs` 内，勿在 `config.json` 里配置旧的 `images_upload/v1/create`（该接口已下线 404）。

## 命令速查

| 场景 | 命令（均在 `scripts/` 下执行） |
|---|---|
| 首次登录 | `node scripts/login.mjs`（弹浏览器，人工登录，自动存会话） |
| 会话体检 | `node scripts/check.mjs`（失效则重新 login，Cookie 有效期约 30 天） |
| 分类/标签查询 | `node scripts/tags.mjs`（全量翻页拉取约 700 标签并缓存）；`node scripts/tags.mjs 前端`（按名查询 id） |
| **元信息检查** | `node scripts/frontmatter.mjs article.md`（缺字段给建议，只提示不改写）；`--json` 输出结构化报告；`--require title,description` 单次自定义；`--strict` 缺失即 exit 2 |
| **掘金热榜** | `node scripts/hot.mjs`（综合榜 20 条，无需登录）；`node scripts/hot.mjs 前端 --limit 10`（分类筛选）；`--json` 输出 JSON；`--categories` 列分类 |
| **图片上传** | `node scripts/upload-images.mjs article.md`（本地图片 → 掘金 CDN，输出 `<name>.juejin.md`）；`--in-place` 原地改写（留 `.bak`）；`--dry-run` 只扫描 |
| **存草稿（默认）** | `node scripts/publish.mjs article.md`（检测到本地图片时**自动上传并改写**，`--no-upload` 跳过） |
| 试算请求体 | `node scripts/publish.mjs article.md --dry-run`（不联网） |
| **公开发布** | `node scripts/publish.mjs article.md --publish --yes`（双标志缺一不可） |
| **发布网页端草稿** | `node scripts/publish.mjs article.md --draft-id <草稿id> --publish --yes`（**跳过重建草稿**，正文以网页端为准，md 仅提供分类/标签/摘要/封面） |

## 掘金热榜（无需登录）

- **触发词**：「掘金热榜」「今天掘金热门文章」「前端热榜有哪些」。
- **命令**：`node scripts/hot.mjs [分类] [--limit N] [--json] [--categories]`；默认综合榜热门 20 条，上限 50 条。
- **分类**：`--categories` 列出可用分类；`综合` / `全部` / `all` 走 `category_id=1`（该值不在掘金分类列表里，属榜单约定值）。
- **输出字段**：排名、标题、作者、热度值、浏览/点赞/收藏/评论数、文章链接；`--json` 输出结构化数据供 Agent 或管道消费。
- **无摘要**：掘金 `article_rank` 接口**不返回文章摘要**，不得向用户承诺或编造摘要内容。
- **接口**：`GET https://api.juejin.cn/content_api/v1/content/article_rank?category_id=1&type=hot&aid=2608&spider=0`（2026-11-11 实机核实，公开、无需 Cookie）。
- **只读安全**：不写任何用户数据、不落缓存、单次请求、无循环；`err_no != 0` 原样上报，不盲目重试。
- **`--type new` 待核实**：该参数本次实测返回 Internal Server Error，保留入口但不作能力承诺。

## 发布工作流（agent 执行时严格遵循）

1. **会话体检**：先跑 `check.mjs`；失败引导用户执行 `login.mjs` 并等用户完成浏览器登录。
2. **id 缓存**：缓存超期（默认 7 天，`config.json` 的 `tagCache.maxAgeDays` 可调）会自动全量刷新；分类/标签解析未命中时也会强制刷新自愈一次，仍失败才报错。手动刷新：`node scripts/tags.mjs`。
3. **文章格式检查（必做）**：读到本地 `.md` 后、**发起任何网络请求之前**，必须运行 `node scripts/frontmatter.mjs <article.md>`，**不得凭 Agent 自己 Read 的结果判断字段是否齐全**。规范字段为 `title` / `date` / `description` / `category` / `tags`（另有可选 `cover`）；`summary` / `brief` / `brief_content` 是 `description` 的兼容别名，`tags` 支持 YAML 数组 `[a, b]` 与逗号串。`publish.mjs` 内部也会自动跑同一份检查并把别名折叠为规范 key，默认只提示不阻断。报告有缺失时，向用户复述「缺哪项 / 建议 / 可粘贴片段」，由用户决定是否补齐；用户要求严格模式时用 `--strict`，或把 `config.json` 的 `frontmatter.strict` 设为 `true`。检查规则可由用户自定义（`frontmatter.required` 数组整体替换，或本次用 `--require a,b`）。`date` 仅作本地归档规范，**不参与掘金发布**。无 frontmatter 时标题取正文首个 `# 一级标题`；摘要（`brief_content`）**50–100 字是掘金硬性要求**，脚本会自动补齐，但不满足时优先让用户用 `--description` 显式给出。
4. **本地图片**：`publish.mjs` 自动扫描正文行内图片 `![alt](path)`，走字节 ImageX 三段式链路上传（gen_token STS → ApplyImageUpload SigV4 签名 → POST 直传 tos 带 CRC32 校验 → CommitImageUpload → get_img_url），把编辑器同款签名 URL 写入正文（掘金渲染层动态重签，已实测发布后 3 图全部 HTTP 200）；任何一张失败即**中止发布**。仅支持 png/jpg/jpeg/gif/webp/svg/bmp，单张默认 ≤5MiB。
5. **先草稿**：一律先 `publish.mjs article.md`（默认只建草稿），把草稿链接给用户确认格式。
6. **再发布**：用户在会话中**明确确认**后，才加 `--publish --yes` 公开发布；向用户复述将要发布的标题、分类、标签后再执行。**若用户明确说改的是网页端草稿，必须改用 `--draft-id <草稿id> --publish --yes`**——默认的 `--publish --yes` 每次都会先重建草稿，用本地 md 覆盖网页端修改；`--draft-id` 模式跳过重建，正文以网页端为准（本地 md 只提供分类/标签/摘要/封面）。拿不准改的是哪一边时，先问用户，不要用文件 mtime 推断。

## 安全纪律（不可违反）

- **草稿优先**：`--publish` 与 `--yes` 必须同时出现才会公开发布，这是脚本内的互锁，agent 不得诱导绕过；
- **网页端改稿不被覆盖**：用户明确说改的是网页端草稿时，**禁止**用默认 `--publish --yes`（会先重建草稿、用本地 md 覆盖网页端正文）；必须改用 `--draft-id <草稿id> --publish --yes`。不确定改动在哪一侧时先问用户，不得靠文件 mtime 推断；
- **单次一篇**：一次调用只处理一个文件，不做无人值守批量发布（频控与风控风险）；
- **凭据脱敏**：Cookie 只存 `~/.juejin/session.json`，日志、回复、截图中一律不得出现其内容；
- **非官方接口**：掘金无公开 API 文档，接口可能变更；任何 `err_no != 0` 原样报告给用户，不要猜测重试策略之外的动作。

## 故障排查

| 现象 | 处置 |
|---|---|
| `check.mjs` 报会话失效 | 重新 `login.mjs`（Cookie 约 30 天过期） |
| 分类/标签解析失败 | 跑 `tags.mjs` 更新缓存，核对名称大小写 |
| `brief_content` 相关报错 | 摘要长度不在 50–100，用 `--description` 或 frontmatter 的 `description` 显式提供 |
| frontmatter 报告缺字段 | 按报告里的「建议 / 可粘贴片段」自行补到文章头部（脚本不会改写文件）；或用 `--require a,b` 收窄本次检查项；`--no-frontmatter-check` 可完全跳过 |
| 图片上传 `err_no != 0` / 404 | 现行 ImageX 三段式已实现（见 API 参考）；`MismatchChecksum` = 缺 `Content-CRC32` 头；`201007 bad gateway` = Commit 偶发后端故障，脚本已自动重试一次 |
| 存在图片上传失败被中止 | 按报错修正 md（路径不存在/超限/扩展名不支持），或 `--no-upload` 跳过自动上传 |
| 登录弹窗被拦截 | 设置环境变量 `JUEJIN_CHROME_PATH` 指向本机 Chromium/Chrome 可执行文件（如 Windows 的 chrome.exe）；未设置时脚本会按平台自动扫描 Playwright 缓存，仍失败则由 Playwright 默认解析 |

## API 参考（社区抓包 + 2026-10-23 实测核实，非官方，随时可能变更）

- 创建草稿：`POST https://api.juejin.cn/content_api/v1/article_draft/create`（✅ 已实测成功）
- 发布文章：`POST https://api.juejin.cn/content_api/v1/article/publish`（入参 `draft_id`）
- 会话校验：`GET https://api.juejin.cn/user_api/v1/user/get`（✅ 已实测成功）
- 分类列表：`GET https://api.juejin.cn/tag_api/v1/query_category_briefs`（✅ 已实测成功）
- 掘金热榜：`GET https://api.juejin.cn/content_api/v1/content/article_rank?category_id={id}&type=hot&aid=2608&spider=0`（✅ 2026-11-11 实机核实，公开免登录；`data[]` 含 `content.{content_id,title}`、`author.name`、`content_counter.{hot_rank,view,like,collect,comment_count}`；**不返回摘要**；综合榜 50 条）
- 标签列表：`POST https://api.juejin.cn/tag_api/v1/query_tag_list`（✅ 已实测；`{cursor:"0", limit:100}` 翻页，data 为数组，元素 `{tag_id, tag:{tag_name}}`；**cate_id 参数实际不过滤**，需全量翻页；旧 `query_category_tags` 已下线返回「请求路由不存在」）
- 草稿请求体：`{category_id, tag_ids[], title, brief_content, edit_type:10, mark_content, cover_image, link_url:"", html_content:"deprecated", theme_ids:[]}`
- ~~图片上传：`POST /images_upload/v1/create`~~（**已下线 404**）。现行链路（✅ 已实现并发布实测通过）：`GET /imagex/v2/gen_token?aid=2608&uuid=<19位数字>&client=web`（Cookie）拿 STS → `imagex.bytedanceapi.com?Action=ApplyImageUpload&Version=2018-08-01&ServiceId=73owjymdk6`（**AWS SigV4**，Credential=AK/<date>/cn-north-1/imagex/aws4_request，SignedHeaders=x-amz-date;x-amz-security-token）→ `POST https://<uploadHost>/<StoreUri>`（头 `authorization: <StoreInfos[0].Auth>`、`Content-CRC32: <8位hex>`，缺 CRC32 报 MismatchChecksum 4007）→ `POST ?Action=CommitImageUpload&SessionKey=...`（偶发 201007 bad gateway，重试一次）→ `GET /imagex/v2/get_img_url?...&img_type=private` 返回 `data.main_url`（编辑器同款签名 URL，写进 mark_content 即可）
