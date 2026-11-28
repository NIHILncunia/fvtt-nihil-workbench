import { detectionModeSource, hasKeyedDetectionModes } from '../shared/compat.mjs';
import { addDeletion } from '../shared/deletion.mjs';
const DETECTION_PATH = 'prototypeToken.detectionModes';

function localized(value) {
  return globalThis.game?.i18n?.localize?.(String(value)) ?? String(value);
}

function modeChoices(collection) {
  return Object.fromEntries(
    Object.entries(collection ?? {})
      .filter(([, mode]) => mode.tokenConfig !== false)
      .map(([id, mode]) => [mode.id ?? id, mode.label ?? id]),
  );
}

export function addTokenPerceptionSections({ section, add }) {
  const canvas = globalThis.CONFIG?.Canvas ?? {};
  const vision = section(
    'token',
    '시야·시야 보정'
  );
  vision.hint =
    '시야 모드를 바꾼 뒤 필요하면 모드 기본값을 적용합니다. 거리 단위는 장면 설정을 따릅니다.';
  vision.isTokenVision = true;
  add(
    vision,
    'prototypeToken.sight.angle',
    '시야 각도 (도)',
    'number',
    {
      min: 0,
      max: 360,
    }
  );
  add(
    vision,
    'prototypeToken.sight.visionMode',
    '시야 모드',
    'text',
    {
      choices: modeChoices(canvas.visionModes),
    }
  );
  add(
    vision,
    'prototypeToken.sight.color',
    '시야 색상 (비우면 기본값)',
    'color',
  );
  for (const [key, title, min] of [
    ['attenuation', '시야 감쇠', 0],
    ['brightness', '시야 밝기', -1],
    ['saturation', '시야 채도', -1],
    ['contrast', '시야 대비', -1],
  ])
    add(
      vision,
      `prototypeToken.sight.${key}`,
      title,
      'number',
      {
        min,
        max: 1,
        step: 0.05,
      }
    );

  const light = section(
    'token',
    '토큰 조명'
  );
  light.hint =
    '조명 거리는 장면 단위입니다. 어둠 광원은 밝히는 대신 주변 빛을 차단합니다.';
  for (const [key, title] of [
    ['dim', '희미한 조명 거리'],
    ['bright', '밝은 조명 거리'],
  ])
    add(
      light,
      `prototypeToken.light.${key}`,
      title,
      'number',
      { min: 0 }
    );
  add(
    light,
    'prototypeToken.light.angle',
    '조명 각도 (도)',
    'number',
    {
      min: 0,
      max: 360,
    }
  );
  add(
    light,
    'prototypeToken.light.color',
    '조명 색상 (비우면 기본값)',
    'color',
  );
  add(
    light,
    'prototypeToken.light.alpha',
    '조명 색상 강도',
    'number',
    {
      min: 0,
      max: 1,
      step: 0.05,
    }
  );
  add(
    light,
    'prototypeToken.light.priority',
    '조명 우선순위',
    'number',
    {
      min: 0,
      integer: true,
    }
  );
  add(
    light,
    'prototypeToken.light.negative',
    '어둠 광원',
    'boolean'
  );

  const animation = section(
    'token',
    '조명 애니메이션'
  );
  add(
    animation,
    'prototypeToken.light.animation.type',
    '애니메이션 종류',
    'text',
    { nullable: true, choices: { '': '없음', ...canvas.lightAnimations } },
  );
  add(
    animation,
    'prototypeToken.light.animation.speed',
    '애니메이션 속도',
    'number',
    { min: 0, max: 10, integer: true },
  );
  add(
    animation,
    'prototypeToken.light.animation.intensity',
    '애니메이션 강도',
    'number',
    { min: 1, max: 10, integer: true },
  );
  add(
    animation,
    'prototypeToken.light.animation.reverse',
    '애니메이션 역방향',
    'boolean',
  );

  const adjustments = section(
    'token',
    '조명 표현·활성 범위'
  );
  const techniques =
    globalThis.foundry?.canvas?.rendering?.shaders?.AdaptiveLightingShader
      ?.SHADER_TECHNIQUES ?? {};
  add(
    adjustments,
    'prototypeToken.light.coloration',
    '색상 혼합 방식',
    'number',
    {
      integer: true,
      choices: Object.fromEntries(
        Object.values(techniques).map((entry) => [entry.id, entry.label]),
      ),
    },
  );
  for (const [key, title, min] of [
    ['luminosity', '광도', 0],
    ['attenuation', '조명 감쇠', 0],
    ['saturation', '조명 채도', -1],
    ['contrast', '조명 대비', -1],
    ['shadows', '그림자', 0],
  ])
    add(
      adjustments,
      `prototypeToken.light.${key}`,
      title,
      'number',
      {
        min,
        max: 1,
        step: 0.05,
      }
    );
  for (const [key, title] of [
    ['min', '활성 최소 어둠 수준'],
    ['max', '활성 최대 어둠 수준'],
  ])
    add(
      adjustments,
      `prototypeToken.light.darkness.${key}`,
      title,
      'number',
      {
        min: 0,
        max: 1,
        step: 0.05,
      }
    );

  const detection = section(
    'token',
    '감지 모드'
  );
  detection.isDetectionModes = true;
  detection.hint =
    '감지 거리 입력을 비우면 무제한입니다. 활성 여부를 개별적으로 지정합니다.';
  add(
    detection,
    DETECTION_PATH,
    '감지 모드',
    'json'
  );
}

// Foundry v14: TokenDocument#detectionModes는 { [모드 ID]: { enabled, range } } 객체다(v13까지는 배열).
// 화면은 행 목록으로 다루고, 저장할 때 객체로 바꾼다.
export function detectionModeList(modes) {
  if (Array.isArray(modes)) return modes.map((mode) => ({ ...mode }));
  if (!modes || typeof modes !== 'object') return [];
  return Object.entries(modes).map(([id, mode]) => ({ id, ...mode }));
}

export function tokenDetectionRows(modes = []) {
  const config = modeChoices(globalThis.CONFIG?.Canvas?.detectionModes);
  return detectionModeList(modes).map(
    (
      mode,
      index,
    ) => {
      return {
        ...mode,
        index,
        range: mode.range ?? '',
        options: Object.entries({
          '': '모드 선택',
          ...config,
          ...(mode.id && !(mode.id in config)
            ? { [mode.id]: `${mode.id} (기존 확장 모드)` }
            : {}),
        }).map(([value, label]) => ({
          value,
          label: localized(label),
          selected: value === mode.id,
        })),
      };
    },
  );
}

export function readTokenDetectionInputs(form) {
  const container = form?.querySelector?.('[data-token-detection]');
  if (!container) return undefined;
  const originals = detectionModeList(JSON.parse(
    container.querySelector('[data-detection-source]').value,
  ));
  return Array.from(container.querySelectorAll('[data-detection-row]')).map(
    (
      row,
      index,
    ) => {
      return {
        ...originals[index],
        id: row.querySelector('[data-detection-id]').value,
        enabled: row.querySelector('[data-detection-enabled]').checked,
        range: row.querySelector('[data-detection-range]').value,
      };
    },
  );
}

export function validateTokenDetectionModes(modes) {
  if (!modes || typeof modes !== 'object') throw new Error('감지 모드 목록을 확인하십시오.');
  const ids = new Set();
  const result = [];
  for (const mode of detectionModeList(modes)) {
    const id = String(mode.id ?? '').trim();
    if (!id || ids.has(id) || ['__proto__', 'prototype', 'constructor'].includes(id) || id.includes('.'))
      throw new Error('감지 모드를 선택하고 중복된 모드를 제거하십시오.');
    const range =
      mode.range === '' || mode.range == null ? null : Number(mode.range);
    if (range !== null && (!Number.isFinite(range) || range < 0))
      throw new Error('감지 거리는 0 이상의 숫자를 입력하십시오.');
    ids.add(id);
    result.push({ ...mode, id, enabled: Boolean(mode.enabled), range });
  }
  return detectionModeSource(result);
}

// 객체 필드는 갱신 때 키가 합쳐지므로, 지운 감지 모드는 삭제 키로 따로 보낸다.
export function detectionModeDeletions(before, after, path = DETECTION_PATH) {
  const update = {};
  if (!hasKeyedDetectionModes() || !before || typeof before !== 'object' || Array.isArray(before)) return update;
  for (const id of Object.keys(before)) {
    if (!after || !Object.hasOwn(after, id)) addDeletion(update, `${path}.${id}`);
  }
  return update;
}

export function applyTokenVisionDefaults(form) {
  const mode = form?.querySelector?.(
    '[name="field:prototypeToken.sight.visionMode"]',
  )?.value;
  const defaults =
    globalThis.CONFIG?.Canvas?.visionModes?.[mode]?.vision?.defaults ?? {};
  for (const key of [
    'color',
    'attenuation',
    'brightness',
    'saturation',
    'contrast',
  ]) {
    if (!Object.hasOwn(
      defaults,
      key
    )) continue;
    const control = form.querySelector(
      `[name="field:prototypeToken.sight.${key}"]`,
    );
    if (control) control.value = defaults[key] ?? '';
    const picker = control
      ?.closest?.('label')
      ?.querySelector('[data-token-color-picker]');
    if (picker) picker.value = defaults[key] ?? '#ffffff';
  }
}
