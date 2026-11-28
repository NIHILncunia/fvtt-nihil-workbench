import { cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repository = fileURLToPath(new URL(
  '../',
  import.meta.url,
));
const runtimePaths = ['scripts', 'styles', 'templates', 'assets', 'data'];
const packLogs = new Set(['LOCK', 'LOG', 'LOG.old']);

export function createV13Manifest(
  manifest,
  { tag = `v${manifest.version}`, repoUrl = manifest.url } = {},
) {
  if (tag !== `v${manifest.version}`) throw new Error(`module.json 버전 ${manifest.version}과 태그 ${tag}가 다릅니다.`);
  return {
    ...manifest,
    url: repoUrl,
    compatibility: { minimum: '13', verified: '13.351', maximum: '13' },
    manifest: `${repoUrl}/releases/latest/download/module-v13.json`,
    download: `${repoUrl}/releases/download/${tag}/module-v13.zip`,
    relationships: {
      ...manifest.relationships,
      systems: manifest.relationships.systems.map((system) => system.id === 'dnd5e'
        ? { ...system, compatibility: { minimum: '5.2.4', verified: '6.1.1' } }
        : system),
    },
    packs: manifest.packs.map((pack) => ({
      ...pack,
      path: path.posix.join(
        'packs-v13',
        pack.name,
      ),
    })),
  };
}

export async function buildV13({
  outputRoot = path.join(
    repository,
    'dist',
  ),
  tag,
  repoUrl,
} = {}) {
  const manifest = createV13Manifest(
    JSON.parse(await readFile(
      path.join(
        repository,
        'module.json',
      ),
      'utf8',
    )),
    { tag, repoUrl },
  );
  outputRoot = path.resolve(outputRoot);
  await mkdir(
    outputRoot,
    { recursive: true },
  );
  const staging = await mkdtemp(path.join(
    outputRoot,
    '.v13-',
  ));
  const output = path.join(
    outputRoot,
    'v13',
  );
  const document = `${JSON.stringify(
    manifest,
    null,
    2,
  )}\n`;
  try {
    for (const entry of runtimePaths) {
      await cp(
        path.join(
          repository,
          entry,
        ),
        path.join(
          staging,
          entry,
        ),
        { recursive: true },
      );
    }
    for (const pack of manifest.packs) {
      await cp(
        path.join(
          repository,
          pack.path,
        ),
        path.join(
          staging,
          pack.path,
        ),
        { recursive: true, filter: (entry) => !packLogs.has(path.basename(entry)) },
      );
    }
    await writeFile(
      path.join(
        staging,
        'module.json',
      ),
      document,
    );
    // 빌드 전용 폴더를 통째로 바꿔 이전 판에서 사라진 파일이 남지 않게 한다.
    await rm(
      output,
      { recursive: true, force: true },
    );
    await rename(
      staging,
      output,
    );
    await writeFile(
      path.join(
        outputRoot,
        'module-v13.json',
      ),
      document,
    );
    return manifest;
  } finally {
    await rm(
      staging,
      { recursive: true, force: true },
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await buildV13({ tag: process.env.TAG, repoUrl: process.env.REPO_URL });
}
