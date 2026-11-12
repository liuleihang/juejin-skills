// 安装 pre-commit hook：把提交前校验写入本机 .git/hooks/pre-commit
// 用法：node scripts/install-hooks.mjs
// git 不跟踪 .git/，故 clone 到新机器后需手动运行一次；脚本幂等，可重复执行。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMain } from './is-main.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOOK_PATH = path.join(ROOT, '.git', 'hooks', 'pre-commit');
const HOOK = [
  '#!/bin/sh',
  '# 提交前校验 frontmatter 并构建发布包；校验失败阻断提交。build/ 已被忽略，不进入提交',
  'command -v node >/dev/null 2>&1 || { echo "⚠ node 不可用，跳过校验与 zip 构建"; exit 0; }',
  'node build-zip.mjs || exit 1',
  '',
].join('\n');

const normEol = (s) => s.replace(/\r\n/g, '\n');

function install() {
  if (!fs.existsSync(path.join(ROOT, '.git'))) {
    console.error('✗ 未找到 .git/，请在 Git 工作副本根目录运行（当前解析到：' + ROOT + '）');
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(HOOK_PATH), { recursive: true });
  if (fs.existsSync(HOOK_PATH) && normEol(fs.readFileSync(HOOK_PATH, 'utf8')) === HOOK) {
    console.log('✓ pre-commit 已是最新版本，无需改动：' + HOOK_PATH);
    return;
  }
  fs.writeFileSync(HOOK_PATH, HOOK, 'utf8');
  try { fs.chmodSync(HOOK_PATH, 0o755); } catch { /* Windows 无 POSIX 权限位，忽略 */ }
  console.log('✓ 已安装 pre-commit：' + HOOK_PATH);
}

if (isMain(import.meta.url)) install();
