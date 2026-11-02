---
name: juejin-skills
display_name: 掘金文章发布
display_name_en: Juejin Article Publisher
description: 将本地 Markdown 文章发布到掘金（juejin.cn）。当用户要发布文章到掘金、存掘金草稿、上传文章配图到掘金图床、登录掘金账号、查询掘金分类标签时使用。
description_zh: 把本地 Markdown 文章发布到掘金社区。支持 Playwright 浏览器登录与会话复用、分类/标签 id 查询、本地图片自动上传为掘金 CDN 链接、草稿优先发布（公开发布需双标志二次确认）。
description_en: Publish local Markdown articles to Juejin (juejin.cn). Supports Playwright login with session reuse, category/tag id lookup, automatic local-image upload to Juejin CDN, and draft-first publishing with explicit double confirmation before public release.
allowed-tools: Bash
version: 1.2.0
author: Hone
examples_zh:
  - "把 ./article.md 存为掘金草稿，分类前端，标签 Vue.js"
  - "把这篇文章里的本地图片上传到掘金图床"
  - "登录掘金账号"
examples_en:
  - "Save ./article.md as a Juejin draft, category 前端, tags Vue.js"
  - "Upload the local images in this article to Juejin image host"
  - "Log in to my Juejin account"
agent_created: true
---

# Juejin Skills — 掘金文章发布

将 Markdown 文章发布到掘金（juejin.cn）。掘金无官方公开 API，本 skill 通过社区抓包核实的 Web 接口 + Cookie 鉴权实现，采用**草稿优先**安全策略。

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
  "imageUpload": {
    "endpoint": "https://api.juejin.cn/images_upload/v1/create",
    "query": { "uid": "", "client_id": "2608", "token": "", "sign": "" },
    "fieldName": "file",
    "maxSizeMb": 5,
    "uploadGapMs": 300
  }
}
```

## 命令速查

| 场景 | 命令（均在 `scripts/` 下执行） |
|---|---|
| 首次登录 | `node scripts/login.mjs`（弹浏览器，人工登录，自动存会话） |
| 会话体检 | `node scripts/check.mjs`（失效则重新 login，Cookie 有效期约 30 天） |
| 分类/标签查询 | `node scripts/tags.mjs`（全量翻页拉取约 700 标签并缓存）；`node scripts/tags.mjs 前端`（按名查询 id） |
| **图片上传** | `node scripts/upload-images.mjs article.md`（本地图片 → 掘金 CDN，输出 `<name>.juejin.md`）；`--in-place` 原地改写（留 `.bak`）；`--dry-run` 只扫描 |
| **存草稿（默认）** | `node scripts/publish.mjs article.md`（检测到本地图片时**自动上传并改写**，`--no-upload` 跳过） |
| 试算请求体 | `node scripts/publish.mjs article.md --dry-run`（不联网） |
| **公开发布** | `node scripts/publish.mjs article.md --publish --yes`（双标志缺一不可） |

## 发布工作流（agent 执行时严格遵循）

1. **会话体检**：先跑 `check.mjs`；失败引导用户执行 `login.mjs` 并等用户完成浏览器登录。
2. **id 缓存**：缓存超期（默认 7 天，`config.json` 的 `tagCache.maxAgeDays` 可调）会自动全量刷新；分类/标签解析未命中时也会强制刷新自愈一次，仍失败才报错。手动刷新：`node scripts/tags.mjs`。
3. **文章格式**：支持 frontmatter 字段 `title` / `brief` / `category` / `tags`（逗号分隔）/ `cover`；无 frontmatter 时取正文首个 `# 一级标题` 作标题。摘要（`brief_content`）**50–100 字是掘金硬性要求**，脚本会自动补齐，但不满足时优先让用户用 `--brief` 显式给出。
4. **本地图片**：`publish.mjs` 自动扫描正文行内图片 `![alt](path)`，走字节 ImageX 三段式链路上传（gen_token STS → ApplyImageUpload SigV4 签名 → POST 直传 tos 带 CRC32 校验 → CommitImageUpload → get_img_url），把编辑器同款签名 URL 写入正文（掘金渲染层动态重签，已实测发布后 3 图全部 HTTP 200）；任何一张失败即**中止发布**。仅支持 png/jpg/jpeg/gif/webp/svg/bmp，单张默认 ≤5MiB。
5. **先草稿**：一律先 `publish.mjs article.md`（默认只建草稿），把草稿链接给用户确认格式。
6. **再发布**：用户在会话中**明确确认**后，才加 `--publish --yes` 公开发布；向用户复述将要发布的标题、分类、标签后再执行。

## 安全纪律（不可违反）

- **草稿优先**：`--publish` 与 `--yes` 必须同时出现才会公开发布，这是脚本内的互锁，agent 不得诱导绕过；
- **单次一篇**：一次调用只处理一个文件，不做无人值守批量发布（频控与风控风险）；
- **凭据脱敏**：Cookie 只存 `~/.juejin/session.json`，日志、回复、截图中一律不得出现其内容；
- **非官方接口**：掘金无公开 API 文档，接口可能变更；任何 `err_no != 0` 原样报告给用户，不要猜测重试策略之外的动作。

## 故障排查

| 现象 | 处置 |
|---|---|
| `check.mjs` 报会话失效 | 重新 `login.mjs`（Cookie 约 30 天过期） |
| 分类/标签解析失败 | 跑 `tags.mjs` 更新缓存，核对名称大小写 |
| `brief_content` 相关报错 | 摘要长度不在 50–100，用 `--brief` 显式提供 |
| 图片上传 `err_no != 0` / 404 | 现行 ImageX 三段式已实现（见 API 参考）；`MismatchChecksum` = 缺 `Content-CRC32` 头；`201007 bad gateway` = Commit 偶发后端故障，脚本已自动重试一次 |
| 存在图片上传失败被中止 | 按报错修正 md（路径不存在/超限/扩展名不支持），或 `--no-upload` 跳过自动上传 |
| 登录弹窗被拦截 | 设置环境变量 `JUEJIN_CHROME_PATH` 指向本机 Chromium/Chrome 可执行文件（如 Windows 的 chrome.exe）；未设置时脚本会按平台自动扫描 Playwright 缓存，仍失败则由 Playwright 默认解析 |

## API 参考（社区抓包 + 2026-10-23 实测核实，非官方，随时可能变更）

- 创建草稿：`POST https://api.juejin.cn/content_api/v1/article_draft/create`（✅ 已实测成功）
- 发布文章：`POST https://api.juejin.cn/content_api/v1/article/publish`（入参 `draft_id`）
- 会话校验：`GET https://api.juejin.cn/user_api/v1/user/get`（✅ 已实测成功）
- 分类列表：`GET https://api.juejin.cn/tag_api/v1/query_category_briefs`（✅ 已实测成功）
- 标签列表：`POST https://api.juejin.cn/tag_api/v1/query_tag_list`（✅ 已实测；`{cursor:"0", limit:100}` 翻页，data 为数组，元素 `{tag_id, tag:{tag_name}}`；**cate_id 参数实际不过滤**，需全量翻页；旧 `query_category_tags` 已下线返回「请求路由不存在」）
- 草稿请求体：`{category_id, tag_ids[], title, brief_content, edit_type:10, mark_content, cover_image, link_url:"", html_content:"deprecated", theme_ids:[]}`
- ~~图片上传：`POST /images_upload/v1/create`~~（**已下线 404**）。现行链路（✅ 已实现并发布实测通过）：`GET /imagex/v2/gen_token?aid=2608&uuid=<19位数字>&client=web`（Cookie）拿 STS → `imagex.bytedanceapi.com?Action=ApplyImageUpload&Version=2018-08-01&ServiceId=73owjymdk6`（**AWS SigV4**，Credential=AK/<date>/cn-north-1/imagex/aws4_request，SignedHeaders=x-amz-date;x-amz-security-token）→ `POST https://<uploadHost>/<StoreUri>`（头 `authorization: <StoreInfos[0].Auth>`、`Content-CRC32: <8位hex>`，缺 CRC32 报 MismatchChecksum 4007）→ `POST ?Action=CommitImageUpload&SessionKey=...`（偶发 201007 bad gateway，重试一次）→ `GET /imagex/v2/get_img_url?...&img_type=private` 返回 `data.main_url`（编辑器同款签名 URL，写进 mark_content 即可）
