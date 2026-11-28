import { effectTimingForWrite } from '../shared/compat.mjs';
import { number, object } from './internal.mjs';

const EFFECT_DURATION_UNITS = Object.freeze(['years', 'months', 'days', 'hours', 'minutes', 'seconds', 'rounds', 'turns']);
const LEGACY_EFFECT_DURATION_KEYS = Object.freeze(['seconds', 'rounds', 'turns', 'startTime', 'startRound', 'startTurn', 'combat']);

// 효과 지속시간을 v14 구조로 만든다. 새 형식 { value, units, expiry }와
// 예전 형식 { seconds|rounds|turns, startTime, startRound, startTurn, combat }을 모두 받는다.
// 돌려주는 값: { duration, start } (start는 시작 정보가 없으면 null)
export function buildEffectDuration(
  input = {},
  explicitStart,
) {
  const data = object(input);
  const duration = {};
  let start = null;
  const legacy = LEGACY_EFFECT_DURATION_KEYS.filter((key) => data[key] != null);
  if (legacy.length && (data.value != null || data.units != null))
    throw new Error('효과 지속시간의 새 형식(value·units)과 예전 형식(seconds·rounds·turns)을 섞지 마십시오.');
  for (const key of ['seconds', 'rounds', 'turns']) {
    if (data[key] == null) continue;
    number(data[key], { integer: key !== 'seconds' });
    if (duration.units) continue;
    duration.value = data[key];
    duration.units = key;
  }
  if (data.value != null) {
    number(data.value, { integer: true });
    duration.value = data.value;
  }
  if (data.units != null) {
    if (!EFFECT_DURATION_UNITS.includes(data.units))
      throw new Error('지원하지 않는 효과 지속 단위입니다.');
    duration.units = data.units;
  }
  if (data.expiry !== undefined) {
    if (data.expiry !== null && typeof data.expiry !== 'string')
      throw new TypeError('효과 만료 시점을 문자열로 전달하십시오.');
    duration.expiry = data.expiry || null;
  }
  const starts = { startTime: 'time', startRound: 'round', startTurn: 'turn' };
  for (const [key, target] of Object.entries(starts)) {
    if (data[key] == null) continue;
    number(data[key], { integer: true });
    (start ??= {})[target] = data[key];
  }
  if (data.combat != null) (start ??= {}).combat = String(data.combat);
  return effectTimingForWrite(
    data,
    duration,
    start,
    explicitStart,
  );
}
