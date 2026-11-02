// 首次登录：Playwright 打开掘金登录页 → 用户手动登录（扫码/密码）→
// 轮询到 sessionid / sessionid_ss 即认为登录成功 → Cookie 持久化到 ~/.juejin/session.json
// 依赖：playwright（未安装时给出安装指引）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { JUEJIN_WEB_URL, COOKIE_FILE, SESSION_DIR, ensureSessionDir } from './config.mjs';

const MAX_WAIT_MS = 5 * 60 * 1000; // 登录等待上限 5 分钟（人工操作，墙钟必须有界）
const POLL_INTERVAL_MS = 2000;

// 定位可用的 Chromium：优先环境变量，其次按平台扫描 ms-playwright 缓存目录；
// 三平台均未命中时返回 null，交给 playwright 默认解析（launch 不带 executablePath）
function findChromium() {
  if (process.env.JUEJIN_CHROME_PATH && fs.existsSync(process.env.JUEJIN_CHROME_PATH)) {
    return process.env.JUEJIN_CHROME_PATH;
  }
  // Playwright 浏览器缓存根目录（三平台各不相同）
  const roots = process.platform === 'win32'
    ? [path.join(process.env.LOCALAPPDATA || '', 'ms-playwright')]
    : process.platform === 'darwin'
      ? [path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright')]
      : [path.join(os.homedir(), '.cache', 'ms-playwright')];
  // chromium-XXXX 版本目录下的可执行文件候选（新/旧版本目录名并存）
  const exeCandidates = process.platform === 'win32'
    ? [['chrome-win64', 'chrome.exe'], ['chrome-win', 'chrome.exe']]
    : process.platform === 'darwin'
      ? [['chrome-mac', 'Chromium.app/Contents/MacOS/Chromium'], ['chrome-mac-arm64', 'Chromium.app/Contents/MacOS/Chromium']]
      : [['chrome-linux', 'chrome'], ['chrome-linux64', 'chrome']];
  for (const root of roots) {
    try {
      const dirs = fs
        .readdirSync(root)
        .filter((d) => d.startsWith('chromium-') && !d.startsWith('chromium_'))
        .sort((a, b) => parseInt(b.split('-')[1], 10) - parseInt(a.split('-')[1], 10));
      for (const d of dirs) {
        for (const [sub, exeName] of exeCandidates) {
          const exe = path.join(root, d, ...sub.split('/'), exeName);
          if (fs.existsSync(exe)) return exe;
        }
      }
    } catch {
      /* 该缓存根不存在则跳过 */
    }
  }
  return null;
}

async function main() {
  ensureSessionDir();
  let playwright;
  try {
    playwright = await import('playwright');
  } catch {
    console.error('[login] 缺少依赖 playwright。安装方式：');
    console.error('  将本 skill 的 scripts 目录在含 playwright 的 node workspace 内运行，');
    console.error('  或执行：npm install playwright && npx playwright install chromium');
    process.exit(1);
  }

  const exe = findChromium();
  const launchOpts = { headless: false };
  if (exe) launchOpts.executablePath = exe;

  const browser = await playwright.chromium.launch(launchOpts);
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${JUEJIN_WEB_URL}/login`);
  console.log('[login] 浏览器已打开，请在窗口中完成登录（扫码/密码）。');
  console.log('[login] 检测到登录成功后将自动保存会话并关闭浏览器（最长等待 5 分钟）。');

  let cookies = null;
  const deadline = Date.now() + MAX_WAIT_MS;
  while (Date.now() < deadline) {
    await page.waitForTimeout(POLL_INTERVAL_MS);
    const list = await context.cookies();
    const names = new Set(list.map((c) => c.name));
    if (names.has('sessionid') || names.has('sessionid_ss')) {
      await page.waitForTimeout(2000); // 等 Cookie 全部落定
      cookies = await context.cookies();
      break;
    }
  }
  await browser.close();

  if (!cookies) {
    console.error('[login] 等待登录超时（5 分钟），未保存任何会话。请重试。');
    process.exit(2);
  }

  fs.writeFileSync(COOKIE_FILE, JSON.stringify(cookies, null, 2), 'utf8');
  try {
    fs.chmodSync(COOKIE_FILE, 0o600); // POSIX 下收紧权限；Windows 为尽力而为
  } catch {
    /* Windows 无 chmod 语义 */
  }
  console.log(`[login] 登录成功。会话已保存到 ${COOKIE_FILE}`);
  console.log('[login] ⚠️ 该文件等同于你的掘金登录凭证，泄露即冒用，请勿提交到任何仓库。');
}

main().catch((err) => {
  console.error('[login] 失败：', err.message);
  process.exit(1);
});
