// 会话体检：验证 ~/.juejin/session.json 中的 Cookie 是否仍有效
import { api, cookiesToHeader, loadCookies, COOKIE_FILE } from './config.mjs';

async function main() {
  const cookies = loadCookies();
  if (!cookies.length) {
    console.error(`[check] 未找到会话文件 ${COOKIE_FILE}，请先运行：node scripts/login.mjs`);
    process.exit(1);
  }
  const data = await api('https://api.juejin.cn/user_api/v1/user/get', {
    cookie: cookiesToHeader(cookies),
  });
  if (data && data.err_no === 0 && data.data) {
    const name = data.data.user_name || '(未知昵称)';
    console.log(`[check] 会话有效 ✓  当前用户：${name}`);
  } else {
    console.error(`[check] 会话已失效（err_no=${data && data.err_no}）。请重新运行：node scripts/login.mjs`);
    process.exit(2);
  }
}

main().catch((err) => {
  console.error('[check] 请求失败：', err.message);
  console.error('网络异常或接口变更；若持续失败请抓包核对端点。');
  process.exit(1);
});
