// CI 语法门禁：对全部前端模块与 Node 脚本执行 `node --check`。
import { readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const targets = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(js|mjs)$/.test(name)) targets.push(p);
  }
}
walk(join(ROOT, 'web', 'js'));
targets.push(join(ROOT, 'server.mjs'));
for (const f of ['selftest.mjs', 'fake-upstream.mjs', 'visual-qa.mjs']) {
  const p = join(ROOT, 'test', f);
  try { statSync(p); targets.push(p); } catch (e) { /* 可选脚本 */ }
}

let bad = 0;
for (const file of targets) {
  const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (r.status !== 0) {
    bad++;
    console.error('✗ ' + file.replace(ROOT + '/', '') + '\n' + (r.stderr || r.stdout));
  }
}
if (bad) {
  console.error('\n' + bad + ' / ' + targets.length + ' 个文件语法检查失败');
  process.exit(1);
}
console.log('✓ ' + targets.length + ' 个文件语法检查通过');
