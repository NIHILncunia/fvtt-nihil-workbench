// 씬 워크벤치 계산·데이터 도우미(2026-11-21).
// 마스터 확정: 입력은 가로 칸 수·배경색(검은색 고정)·밝기·전역 조명 켬/끔·어둠 레벨만.
// 격자 크기 = 이미지 너비 ÷ 가로 칸 수(반올림), 장면 크기 = 이미지 원본 크기. 칸 수는 씬 플래그에만 남긴다.
// Foundry v14: 배경 이미지·배경색은 씬이 아니라 레벨(Level) 문서에 있다.

export const MODULE_ID = 'nihil-compendium-module';
export const SCENE_BACKGROUND_COLOR = '#000000';
export const MIN_GRID_SIZE = 20;

export function gridFromColumns(width, height, columns) {
  const w = Number(width);
  const h = Number(height);
  const c = Number(columns);
  if (!Number.isFinite(w) || w <= 0 || !Number.isFinite(h) || h <= 0)
    throw new Error('배경 이미지 크기를 알 수 없습니다. 이미지를 다시 고르십시오.');
  if (!Number.isInteger(c) || c < 1) throw new Error('가로 칸 수는 1 이상의 정수로 넣으십시오.');
  const size = Math.round(w / c);
  if (size < MIN_GRID_SIZE)
    throw new Error(`가로 칸이 너무 많습니다. 격자 한 칸이 ${MIN_GRID_SIZE}px 이상이 되도록 ${Math.floor(w / MIN_GRID_SIZE)}칸 이하로 넣으십시오.`);
  const rows = h / size;
  return {
    size,
    columns: c,
    rows: Math.round(rows * 100) / 100,
    exact: w % c === 0 && Number.isInteger(rows),
  };
}

// 기존 씬처럼 격자 크기로부터 가로 칸 수를 거꾸로 구한다(워크벤치로 만들지 않은 씬을 열 때).
export function columnsFromGrid(width, gridSize) {
  const w = Number(width);
  const s = Number(gridSize);
  if (width == null || !Number.isFinite(w) || w <= 0 || !Number.isFinite(s) || s <= 0) return null;
  return Math.max(1, Math.round(w / s));
}

function clamp(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

export function normalizeSceneInput(input = {}) {
  const name = String(input.name ?? '').trim();
  if (!name) throw new Error('씬 이름을 넣으십시오.');
  const src = String(input.src ?? '').trim();
  if (!src) throw new Error('배경 이미지를 고르십시오.');
  const grid = gridFromColumns(input.width, input.height, input.columns);
  return {
    name,
    src,
    width: Math.round(Number(input.width)),
    height: Math.round(Number(input.height)),
    grid,
    luminosity: Math.round(clamp(input.luminosity, -1, 1, 0) * 100) / 100,
    globalLight: Boolean(input.globalLight),
    darkness: Math.round(clamp(input.darkness, 0, 1, 0) * 100) / 100,
  };
}

// 새 씬 데이터(레벨 배경은 만든 뒤 sceneLevelUpdate로 따로 넣는다).
export function sceneCreateData(input) {
  const v = normalizeSceneInput(input);
  return {
    name: v.name,
    // 월드에 활성 씬이 없으면 코어가 새 씬을 자동으로 활성화해 접속자 화면을 바꾼다. 워크벤치는 만들기만 한다.
    active: false,
    width: v.width,
    height: v.height,
    grid: { type: 1, size: v.grid.size },
    environment: {
      darknessLevel: v.darkness,
      globalLight: { enabled: v.globalLight },
      base: { luminosity: v.luminosity },
    },
    flags: { [MODULE_ID]: { sceneWorkbench: { columns: v.grid.columns, src: v.src } } },
  };
}

// 기존 씬 갱신(점 경로). 크기·격자·환경과 칸 수 플래그.
export function sceneUpdateData(input) {
  const v = normalizeSceneInput(input);
  return {
    name: v.name,
    width: v.width,
    height: v.height,
    'grid.size': v.grid.size,
    'environment.darknessLevel': v.darkness,
    'environment.globalLight.enabled': v.globalLight,
    'environment.base.luminosity': v.luminosity,
    [`flags.${MODULE_ID}.sceneWorkbench`]: { columns: v.grid.columns, src: v.src },
  };
}

export function sceneLevelUpdate(src) {
  return { background: { src, color: SCENE_BACKGROUND_COLOR } };
}

// 씬 문서 → 편집 칸 값.
export function readSceneState(scene) {
  if (!scene) return null;
  const source = scene.toObject ? scene.toObject() : scene;
  const level = (source.levels ?? []).find((entry) => entry._id === source.initialLevel) ?? (source.levels ?? [])[0] ?? null;
  const flag = source.flags?.[MODULE_ID]?.sceneWorkbench ?? {};
  const src = level?.background?.src ?? flag.src ?? '';
  const width = source.width ?? null;
  const height = source.height ?? null;
  const columns = flag.columns ?? columnsFromGrid(width, source.grid?.size);
  return {
    id: source._id ?? scene.id ?? null,
    name: source.name ?? '',
    src,
    width,
    height,
    columns,
    luminosity: source.environment?.base?.luminosity ?? 0,
    globalLight: Boolean(source.environment?.globalLight?.enabled),
    darkness: source.environment?.darknessLevel ?? 0,
    levelId: level?._id ?? null,
    backgroundColor: level?.background?.color ?? null,
  };
}

export function emptySceneState() {
  return { id: null, name: '', src: '', width: null, height: null, columns: 20, luminosity: 0, globalLight: true, darkness: 0, levelId: null, backgroundColor: SCENE_BACKGROUND_COLOR };
}

// 그림 이름에서 기본 씬 이름을 만든다(경로의 파일 이름).
export function sceneNameFromEntry(entry) {
  if (entry?.name) return String(entry.name);
  const file = String(entry?.url ?? '').split('/').pop() ?? '';
  return file.replace(/\.[^.]+$/, '');
}
