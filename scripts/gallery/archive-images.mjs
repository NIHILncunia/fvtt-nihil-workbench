// 기록보관소 업무 API(ncoc-archive/v1)의 이미지 목록을 Foundry 이미지 갤러리용으로 읽는다.
// 이미지 파일은 R2 공개 주소(https://nihilncunia-images.com/...)이고, 목록은 이미지 조회 전용 토큰으로 받는다.
// 토큰은 GM 브라우저의 client 설정(archiveImageToken)에만 둔다. 2026-11-21 마스터 결정.

export const MODULE_ID = 'nihil-compendium-module';
export const TOKEN_SETTING = 'archiveImageToken';
export const ARCHIVE_API_URL = 'https://npress-archive.nihilncunia.com/wp-json/ncoc-archive/v1';
const PER_PAGE = 200;
const CACHE_MS = 5 * 60 * 1000;

// 칸 종류별로 보여 줄 목록. 맵은 배틀맵과 풍경 두 갈래다.
export const GALLERY_KINDS = Object.freeze({
  portrait: {
    title: '초상화',
    sources: [{ id: 'portrait', label: '초상화', area: 'char', role: '초상화' }],
  },
  token: {
    title: '토큰',
    sources: [{ id: 'token', label: '토큰', area: 'char', role: '토큰' }],
  },
  map: {
    title: '맵',
    sources: [
      { id: 'battlemap', label: '배틀맵', area: 'map', role: '' },
      { id: 'landscape', label: '풍경', area: 'lndscp', role: '' },
    ],
  },
  // 아이템 아이콘은 물건의 정사각 설정화(1254×1254)만 쓴다(2026-11-21 마스터 결정, 이미지 규칙 2026-11-12).
  item: {
    title: '아이템 아이콘',
    sources: [{ id: 'item', label: '정사각 설정화', area: 'concept', role: '정사각 설정화' }],
  },
});

export function galleryKind(kind) {
  const config = GALLERY_KINDS[kind];
  if (!config) throw new Error(`알 수 없는 갤러리 종류입니다: ${kind}`);
  return config;
}

export function imageQuery({ area, role = '', page = 1, perPage = PER_PAGE }) {
  const params = new URLSearchParams({ area, page: String(page), perPage: String(perPage) });
  if (role) params.set('role', role);
  return `${ARCHIVE_API_URL}/images?${params}`;
}

function baseName(path) {
  const name = String(path ?? '').split('/').pop() ?? '';
  return name.replace(/\.[^.]+$/, '');
}

function stripRole(name, role) {
  return name && role && name.endsWith(` ${role}`) ? name.slice(0, -(role.length + 1)) : name;
}

// 그림 경로·DB 파일 이름에서 대상 이름을 얻는다. 크리처 그림은 `<폴더>/<종류>.webp`(종류 파일)라
// 경로의 파일 이름이 종류뿐이면 DB 파일 이름(`<폴더[ 바리에이션]> <종류>.webp`, 2026-11-12 규칙)에서 종류를 떼고,
// 그것도 없으면 종류 파일 바로 위 폴더 이름을 쓴다. 설정화는 「<폴더 이름> <종류>」 이름이라 종류를 뗀다.
export function imageSubjectName(item) {
  const role = String(item?.role ?? '');
  const stem = baseName(item?.path);
  if (stem && stem !== role) return stripRole(stem, role);
  const dbName = stripRole(baseName(item?.fileName), role);
  if (dbName && dbName !== role) return dbName;
  const folders = String(item?.path ?? '').split('/');
  return folders.length > 1 ? folders[folders.length - 2] : (stem || null);
}

// API 항목 → 갤러리 카드. 올라가지 않았거나(주소 없음) 사용 안 함 표시가 된 그림은 뺀다.
// 크리처와 연결되지 않은 캐릭터 그림(정체 미상 NPC 기본 포트 등)은 폴더 이름을 카드 이름으로 쓴다(2026-11-21).
export function galleryEntry(item, source) {
  if (!item?.url || item.use === 'N') return null;
  const creature = item.creature ?? null;
  const fileName = baseName(item.path);
  const subjectName = source.area === 'char' || source.area === 'concept' ? imageSubjectName(item) : fileName;
  const name = creature?.name || subjectName || item.fileName || item.imageId;
  const group = source.area === 'char'
    ? (creature?.classification || '분류 없음')
    : source.area === 'concept'
      ? (item.world || '세계 없음')
      : (item.theme || '테마 없음');
  const details = source.area === 'char'
    ? [item.world, creature?.pantheon].filter(Boolean)
    : source.area === 'concept'
      ? [item.role].filter(Boolean)
      : [item.theme].filter(Boolean);
  return {
    id: `${source.id}:${item.imageId}`,
    source: source.id,
    url: item.url,
    name,
    group,
    world: item.world ?? null,
    details,
    role: item.role ?? '',
    width: item.width ?? null,
    height: item.height ?? null,
    search: [name, item.path, item.role, group, item.world, creature?.pantheon].filter(Boolean).join(' ').toLowerCase(),
  };
}

export function filterEntries(entries, { source = null, search = '', group = '' } = {}) {
  const words = String(search).toLowerCase().split(/\s+/).filter(Boolean);
  return entries.filter((entry) =>
    (!source || entry.source === source)
    && (!group || entry.group === group)
    && words.every((word) => entry.search.includes(word)));
}

// 카드는 이름순(숫자는 수 크기대로, 숫자가 한글보다 앞)으로 놓는다. 「000 정체 미상」 기본 포트가
// 초상화·토큰 전체 보기의 맨 앞에 오게 하려는 2026-11-21 마스터 결정이다. 이름이 같으면 경로순을 유지한다.
const nameCollator = new Intl.Collator('ko', { numeric: true });
export function sortEntries(entries) {
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => nameCollator.compare(a.entry.name, b.entry.name) || a.index - b.index)
    .map(({ entry }) => entry);
}

export function entryGroups(entries) {
  const counts = new Map();
  for (const entry of entries) counts.set(entry.group, (counts.get(entry.group) ?? 0) + 1);
  return [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'ko'))
    .map(([value, count]) => ({ value, count }));
}

export function readImageToken() {
  try {
    return String(globalThis.game?.settings?.get?.(MODULE_ID, TOKEN_SETTING) ?? '').trim();
  } catch {
    return '';
  }
}

export async function saveImageToken(token) {
  await globalThis.game.settings.set(MODULE_ID, TOKEN_SETTING, String(token ?? '').trim());
}

export function registerGallerySettings() {
  const settings = globalThis.game?.settings;
  if (!settings?.register) return false;
  settings.register(MODULE_ID, TOKEN_SETTING, {
    name: '기록보관소 이미지 토큰',
    hint: '니힐 워크벤치 이미지 갤러리가 기록보관소에서 이미지 목록을 받을 때 쓰는 조회 전용 토큰입니다. 이 브라우저에만 저장됩니다.',
    scope: 'client',
    config: true,
    restricted: true,
    type: String,
    default: '',
  });
  return true;
}

export class ArchiveImageError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const cache = new Map();

export function clearImageCache() {
  cache.clear();
}

async function fetchSource(source, token, fetcher) {
  const entries = [];
  for (let page = 1; page <= 20; page += 1) {
    let response;
    try {
      response = await fetcher(imageQuery({ area: source.area, role: source.role, page }), {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
    } catch {
      throw new ArchiveImageError('NETWORK', '기록보관소에 연결하지 못했습니다. 네트워크를 확인하고 다시 시도하십시오.');
    }
    if (response.status === 401 || response.status === 403)
      throw new ArchiveImageError('AUTH', '기록보관소 이미지 토큰이 맞지 않습니다. 토큰을 다시 입력하십시오.');
    let body;
    try {
      body = await response.json();
    } catch {
      throw new ArchiveImageError('RESPONSE', '기록보관소 응답을 읽지 못했습니다.');
    }
    if (!response.ok || body?.error) throw new ArchiveImageError('RESPONSE', body?.message ?? '이미지 목록을 받지 못했습니다.');
    for (const item of body.data?.items ?? []) {
      const entry = galleryEntry(item, source);
      if (entry) entries.push(entry);
    }
    if (page >= (body.data?.pages ?? 1)) break;
  }
  return entries;
}

// 종류에 맞는 모든 갈래의 목록을 받는다. 같은 종류는 5분 동안 다시 받지 않는다.
export async function loadGalleryEntries(kind, { force = false, token = readImageToken(), fetcher = globalThis.fetch?.bind(globalThis), now = Date.now() } = {}) {
  if (!token) throw new ArchiveImageError('TOKEN', '기록보관소 이미지 토큰을 입력하십시오.');
  const cached = cache.get(kind);
  if (!force && cached && now - cached.at < CACHE_MS && cached.token === token) return cached.entries;
  const config = galleryKind(kind);
  const lists = await Promise.all(config.sources.map((source) => fetchSource(source, token, fetcher)));
  const entries = sortEntries(lists.flat());
  cache.set(kind, { at: now, token, entries });
  return entries;
}
