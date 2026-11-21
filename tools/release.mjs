// 사용법: pnpm release <판>  (예: pnpm release 0.2.1)
// module.json의 version·download를 새 판으로 바꾸고, 시험을 돌린 뒤 커밋·태그·푸시한다.
// 태그 푸시를 받으면 GitHub Actions(.github/workflows/release.yml)가 릴리스를 만든다.
// Foundry v14 서버는 module.json manifest 주소로 새 판을 확인해 갱신한다.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) {
  console.error('판을 x.y.z 형식으로 주십시오. 예: pnpm release 0.2.1');
  process.exit(1);
}

const run = (command, args) => execFileSync(command, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
const read = (command, args) => execFileSync(command, args, { cwd: root, encoding: 'utf8' }).trim();

if (read('git', ['status', '--porcelain'])) {
  console.error('커밋하지 않은 변경이 있습니다. 먼저 커밋한 뒤 릴리스하십시오.');
  process.exit(1);
}
if (read('git', ['tag', '--list', `v${version}`])) {
  console.error(`v${version} 태그가 이미 있습니다.`);
  process.exit(1);
}

const file = path.join(root, 'module.json');
const manifest = JSON.parse(readFileSync(file, 'utf8'));
manifest.version = version;
manifest.download = `${manifest.url}/releases/download/v${version}/module.zip`;
writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);

run('node', ['--test', 'tests/*.test.mjs']);

const now = new Date();
const stamp = `${now.getFullYear()} ${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
run('git', ['add', 'module.json']);
run('git', ['commit', '-m', `${stamp} [release]: v${version} 배포`]);
run('git', ['tag', `v${version}`]);
run('git', ['push', 'origin', 'HEAD']);
run('git', ['push', 'origin', `v${version}`]);
console.log(`v${version} 태그를 올렸습니다. GitHub Actions 릴리스가 끝나면 Foundry에서 모듈을 갱신하십시오.`);
