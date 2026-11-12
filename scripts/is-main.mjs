// CLI 入口守卫：判断当前模块是否作为主模块直接运行。
// junction 场景下 Node 会把主模块 realpath 化，而 argv[1] 保留链接路径，
// 直接字符串比较会导致从 ~/.workbuddy/skills 调用时静默不执行。
// argv[1] 也可能是 '-'（node - 从 stdin 执行）等不存在的路径，此时安全返回空串，
// 否则 import 本模块的调用方也会崩（违背「import 无副作用」）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function norm(p) {
  try { return fs.realpathSync(path.resolve(p)).toLowerCase(); }
  catch { return ''; }
}

export function isMain(moduleUrl) {
  const mainPath = norm(fileURLToPath(moduleUrl));
  const argvPath = process.argv[1] ? norm(process.argv[1]) : '';
  return Boolean(argvPath) && argvPath === mainPath;
}
