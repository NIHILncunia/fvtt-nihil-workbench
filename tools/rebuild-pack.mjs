// 사용법: node tools/rebuild-pack.mjs <팩 폴더> <내보낸 JSON>
// Foundry에서 이관한 문서(JSON: { actors|items: [...], folders: [...] })로 컴펜디움 LevelDB를 새로 만든다.
// 2026-11-21 common-monsters를 v14.370·dnd5e 6.1.1 이관본으로 다시 만들 때 썼다.
// 내장 문서(items·effects)가 있는 문서는 지원하지 않는다(현재 팩은 내장 문서가 없다).
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rename, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { ClassicLevel } = require('classic-level');

const [packDir, jsonFile] = process.argv.slice(2);
if (!packDir || !jsonFile) {
  console.error('사용법: node tools/rebuild-pack.mjs <팩 폴더> <내보낸 JSON>');
  process.exit(1);
}
const data = JSON.parse(await readFile(jsonFile, 'utf8'));
const collections = Object.entries(data).filter(([key]) => key !== 'folders');
if (collections.length !== 1) throw new Error('actors 또는 items 중 하나만 넣으십시오.');
const [collection, documents] = collections[0];

const temp = await mkdtemp(path.join(os.tmpdir(), 'ncm-pack-'));
const target = path.join(temp, 'pack');
const db = new ClassicLevel(target, { keyEncoding: 'utf8', valueEncoding: 'json' });
await db.open();
const batch = db.batch();
for (const folder of data.folders ?? []) batch.put(`!folders!${folder._id}`, folder);
for (const document of documents) {
  for (const embedded of ['items', 'effects']) {
    if (Array.isArray(document[embedded]) && document[embedded].length)
      throw new Error(`${document.name}: 내장 ${embedded}가 있는 문서는 이 도구로 만들 수 없습니다.`);
  }
  batch.put(`!${collection}!${document._id}`, document);
}
await batch.write();
await db.compactRange('!', '~');
await db.close();

await rm(packDir, { recursive: true, force: true });
await rename(target, packDir);
await rm(temp, { recursive: true, force: true });
console.log(JSON.stringify({ pack: packDir, collection, documents: documents.length, folders: (data.folders ?? []).length }));
