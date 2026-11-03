# 🔥 juejin-skills — 掘金社区技能包

![juejin-skills 封面](assets/cover-juejin-skills.png)

> 掘金（juejin.cn）社区 Agent 技能包集合。当前包含**文章发布**：支持 Playwright 浏览器登录与会话复用、分类/标签 id 查询、本地图片自动上传为掘金 CDN 链接、草稿优先的发布流程（公开发布需双标志二次确认）。后续会增加热榜、沸点、签到、文章下载等功能。
>
> ⚠️ 本项目为社区工具，与掘金官方无关。

## ✨ 功能特性

### 📝 文章发布

- 读取本地 Markdown（支持 frontmatter：`title` / `brief` / `category` / `tags` / `cover`），无 frontmatter 时自动取正文首个一级标题作标题
- 摘要长度 **50–100 字**（掘金硬性要求）自动补齐，不满足时警告并建议用 `--brief` 显式提供
- **草稿优先**：默认只创建草稿，把草稿链接交给用户确认格式后再公开发布
- **双标志互锁**：`--publish` 与 `--yes` 必须同时出现才会公开发布，脚本内硬编码互锁，防止误发

### 🖼️ 本地图片自动上传

- 自动扫描正文行内图片 `![alt](path)`，走编辑器同款**字节 ImageX 三段式链路**上传：
  `gen_token (STS)` → `ApplyImageUpload (AWS SigV4)` → `POST 直传 tos（含 CRC32 校验）` → `CommitImageUpload` → `get_img_url`
- 上传成功后把掘金 CDN 签名 URL **自动改写进正文**（掘金渲染层会动态重签，无死链风险）
- 任何一张图片上传失败即**中止发布**，避免发出死链文章
- 支持 png / jpg / jpeg / gif / webp / svg / bmp，单张默认 ≤ 5 MiB（可配置）

### 🔐 登录与会话管理

- 首次使用通过 **Playwright 弹出浏览器**人工登录，会话凭据持久化到 `~/.juejin/session.json`（仓库外），Cookie 约 30 天有效
- `check.mjs` 一键会话体检，失效即引导重新登录
- 凭据绝不入库、日志与回复中绝不打印完整值

### 🏷️ 分类 / 标签查询

- 全量翻页拉取掘金标签（约 700+）并缓存到 `~/.juejin/tag-ids.json`
- 支持按名称查询 id（`node scripts/tags.mjs 前端`）
- 已适配现行 `query_tag_list` 接口（旧 `query_category_tags` 已下线返回 404）

## 📋 使用方法

### 前置条件

- Node ≥ 18（原生 fetch，**发布脚本零依赖**）
- 仅 `login.mjs` 需要 `playwright` 包与 Chromium（首次登录时引导安装）
- Windows / macOS / Linux 均可（脚本纯 Node API 跨平台）

### 安装

将本目录（含 `SKILL.md` 与 `scripts/`）放入任意 Agent 的 skills 目录即可。

### 命令速查

<table>
  <tr><th width="130">场景</th><th>命令（均在 <code>scripts/</code> 下执行）</th></tr>
  <tr><td nowrap><b>首次登录</b></td><td><code>node scripts/login.mjs</code>（弹浏览器，人工登录，自动存会话）</td></tr>
  <tr><td nowrap><b>会话体检</b></td><td><code>node scripts/check.mjs</code>（失效则重新 login）</td></tr>
  <tr><td nowrap><b>分类/标签查询</b></td><td><code>node scripts/tags.mjs</code>（全量翻页并缓存）；<code>node scripts/tags.mjs 前端</code>（按名查 id）</td></tr>
  <tr><td nowrap><b>图片上传</b></td><td><code>node scripts/upload-images.mjs article.md</code>（输出 <code>&lt;name&gt;.juejin.md</code>）；<code>--in-place</code> 原地改写（留 <code>.bak</code>）；<code>--dry-run</code> 只扫描</td></tr>
  <tr><td nowrap><b>存草稿（默认）</b></td><td><code>node scripts/publish.mjs article.md</code>（检测到本地图片时自动上传并改写）</td></tr>
  <tr><td nowrap><b>试算请求体</b></td><td><code>node scripts/publish.mjs article.md --dry-run</code>（不联网）</td></tr>
  <tr><td nowrap><b>公开发布</b></td><td><code>node scripts/publish.mjs article.md --publish --yes</code>（双标志缺一不可）</td></tr>
</table>

`publish.mjs` 可选参数：`--brief "摘要"`、`--category 前端`、`--tag "Vue.js,前端"`、`--cover <url>`、`--no-upload`（跳过图片自动上传）。

### 自然语言使用示例（Agent 内）

直接对 AI 说出以下指令即可：

| 功能 | 示例指令 |
|---|---|
| 登录掘金 | 「登录掘金账号」 |
| 查标签 id | 「掘金有哪些标签？Vue.js 的 id 是多少？」 |
| 上传配图 | 「把这篇文章里的本地图片上传到掘金图床」 |
| 存草稿 | 「把 ./article.md 存为掘金草稿，分类前端，标签 Vue.js」 |
| 发布文章 | 「确认无误，发布这篇草稿到掘金」 |

### 文章格式示例

```markdown
---
title: 把掘金发布做成一个 Agent 技能的实践
brief: 掘金没有官方 API，手动搬运文章既繁琐又容易丢格式。
  本文给出把发布流程封装为 Agent 技能的完整实践，并附抓包适配与防呆设计。
category: 前端
tags: AI编程,工程化,效率工具
cover: ./images/cover.png
---

正文……支持本地图片路径，发布时自动上传为掘金 CDN 链接：

![架构图](./images/03-architecture.png)
```

## ⚙️ 配置（可选）

公共路径与参数集中在 `scripts/config.mjs` 的 `DEFAULTS`，用户可在 `~/.juejin/config.json` 覆盖（无需改代码，两层浅合并）：

```json
{
  "timeoutMs": 30000,
  "sessionDirName": ".juejin",
  "defaults": { "category": "前端", "briefMin": 50, "briefMax": 100 },
  "imageUpload": {
    "maxSizeMb": 5,
    "uploadGapMs": 300
  }
}
```

## 🏗️ 项目结构

```
juejin-skills/
├── SKILL.md                 # 技能定义（frontmatter + 工作流 + API 参考，Agent 据此激活）
├── README.md                # 项目说明（当前文件）
└── scripts/
    ├── config.mjs           # 配置管理（ENDPOINTS 集中定义，~/.juejin/config.json 覆盖）
    ├── login.mjs            # Playwright 浏览器登录，会话存 ~/.juejin/session.json
    ├── check.mjs            # 会话有效性体检
    ├── tags.mjs             # 分类/标签全量翻页查询与缓存
    ├── upload-images.mjs    # ImageX 三段式传图 + 正文改写（纯函数可复用）
    └── publish.mjs          # frontmatter 解析 + 图片自动上传 + 草稿/发布（双标志互锁）
```

## 🔧 技术细节

| 项目 | 说明 |
|---|---|
| 语言 | Node.js ≥ 18（原生 fetch，发布脚本零依赖） |
| 浏览器自动化 | Playwright（仅登录环节） |
| 鉴权方式 | Cookie（Playwright 登录获取，本地持久化） |
| 图片链路 | 字节 ImageX 三段式（AWS SigV4 签名，region `cn-north-1`，service `imagex`） |
| 目标网站 | https://juejin.cn/ |
| 实测状态 | 登录 → 标签 → 传图 → 草稿 → 发布 → 渲染验证（图片 HTTP 200）全链路已跑通（2026-10） |

## ⚠️ 注意事项

1. 掘金**无官方公开 API**，本 Skill 基于社区抓包核实的 Web 接口实现，随时可能因掘金接口变更而失效（报 `err_no != 0` 请原样报告，勿盲目重试）；
2. 文章发布需先登录，首次使用会弹浏览器引导登录，Cookie 保存在 `~/.juejin/session.json`，**请勿提交到仓库或分享**；
3. 遵守掘金社区规范，勿发布违规内容；**一次只处理一篇文章**，不做无人值守批量发布（频控与风控风险）；
4. 摘要 50–100 字是掘金接口硬性要求，建议在 frontmatter 的 `brief` 中显式给出；
5. 图片上传失败会**中止发布**以避免死链，按报错修正路径/大小/格式后重试。

## 📄 License

MIT
