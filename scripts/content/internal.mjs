export const MODULE_ID = 'nihil-compendium-module';

export function copy(value) {
  return structuredClone(value);
}

export function object(value = {}) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError('일반 데이터 객체를 전달하십시오.');
  }
  return copy(value);
}

export function text(
  value,
  label = '값',
) {
  if (typeof value !== 'string' || !value.trim())
    throw new TypeError(`${label}을 입력하십시오.`);
  return value.trim();
}

export function number(
  value,
  { min = 0, integer = false } = {},
) {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < min ||
    (integer && !Number.isInteger(value))
  ) {
    throw new TypeError('허용 범위의 유한한 숫자를 전달하십시오.');
  }
  return value;
}

export function code(
  value,
  table,
  { blank = false } = {},
) {
  if (blank && (value === '' || value == null)) return '';
  if (!Object.values(table).includes(value))
    throw new TypeError(`지원하지 않는 기준 코드입니다: ${value}`);
  return value;
}

export function list(
  value,
  table,
) {
  if (!Array.isArray(value)) throw new TypeError('코드 배열을 전달하십시오.');
  return [...new Set(value.map((entry) => code(
    entry,
    table,
  )))];
}

export function runtime() {
  if (globalThis.game?.system?.id !== 'dnd5e' || !globalThis.CONFIG?.DND5E) {
    throw new Error('D&D5e 월드가 준비된 뒤 실행하십시오.');
  }
  return globalThis.CONFIG.DND5E;
}

export function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function merge(
  base,
  patch,
) {
  const output = copy(base);
  for (const [key, value] of Object.entries(patch)) {
    if (['__proto__', 'prototype', 'constructor'].includes(key))
      throw new Error('허용하지 않는 데이터 경로입니다.');
    output[key] =
      value &&
      Object.getPrototypeOf(value) === Object.prototype &&
      output[key] &&
      Object.getPrototypeOf(output[key]) === Object.prototype
        ? merge(
          output[key],
          value,
        )
        : copy(value);
  }
  return output;
}

export function paths(
  source,
  prefix = '',
) {
  const entries = [];
  for (const [key, value] of Object.entries(source)) {
    if (
      ['__proto__', 'prototype', 'constructor'].includes(key) ||
      key.includes('.') ||
      key.startsWith('-=')
    ) {
      throw new Error('소스 객체에는 점 경로나 삭제 연산자를 넣지 마십시오.');
    }
    const path = prefix ? `${prefix}.${key}` : key;
    if (
      value &&
      Object.getPrototypeOf(value) === Object.prototype &&
      Object.keys(value).length
    ) {
      entries.push(...paths(
        value,
        path,
      ));
    } else if (!value || Object.getPrototypeOf(value) !== Object.prototype)
      entries.push([path, copy(value)]);
  }
  return entries;
}

const queues = new Map();
export async function serial(
  key,
  operation,
) {
  const previous = queues.get(key) ?? Promise.resolve();
  const pending = previous.catch(() => {}).then(operation);
  queues.set(
    key,
    pending,
  );
  try {
    return await pending;
  } finally {
    if (queues.get(key) === pending) queues.delete(key);
  }
}

export function checkedResult(
  result,
  label,
) {
  if (!result || (Array.isArray(result) && !result.length))
    throw new Error(`${label}이 취소되었습니다.`);
  return result;
}

export function assertFields(
  source,
  fields,
  prefix = '',
) {
  if (!source || !fields) return;
  for (const [key, value] of Object.entries(source)) {
    if (!Object.hasOwn(
      fields,
      key,
    ))
      throw new Error(`스키마에 없는 필드입니다: ${prefix}${key}`);
    const field = fields[key];
    if (
      field.fields &&
      value &&
      typeof value === 'object' &&
      !Array.isArray(value)
    ) {
      assertFields(
        value,
        field.fields,
        `${prefix}${key}.`,
      );
    }
    if (Array.isArray(value) && field.element?.fields) {
      for (const entry of value)
        assertFields(
          entry,
          field.element.fields,
          `${prefix}${key}.`,
        );
    }
  }
}
