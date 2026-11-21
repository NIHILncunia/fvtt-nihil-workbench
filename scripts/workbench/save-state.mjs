import { advancementSourceList } from '../shared/advancement-source.mjs';
import { itemEditSnapshot } from './document-fields.mjs';

// Keep the existing disabled state: permission-protected controls must stay locked.
export function lockWorkbenchControls(app) {
  const form = app.form ?? app.element;
  const controls = Array.from(form?.querySelectorAll?.('input, textarea, select, button') ?? []);
  const states = controls.map((control) => [control, control.disabled]);
  const busy = form?.getAttribute?.('aria-busy');
  for (const control of controls) control.disabled = true;
  form?.setAttribute?.(
    'aria-busy',
    'true',
  );
  const block = (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  for (const type of ['click', 'keydown', 'dragstart', 'drop'])
    form?.addEventListener?.(
      type,
      block,
      true,
    );
  return () => {
    for (const [control, disabled] of states) control.disabled = disabled;
    if (busy == null) form?.removeAttribute?.('aria-busy');
    else form?.setAttribute?.(
      'aria-busy',
      busy,
    );
    for (const type of ['click', 'keydown', 'dragstart', 'drop'])
      form?.removeEventListener?.(
        type,
        block,
        true,
      );
  };
}

// Advance only acknowledged paths. An unrelated external update stays a conflict.
export function rebaseItemDraftSnapshot(
  snapshot,
  item,
  paths,
) {
  const baseline = JSON.parse(snapshot);
  const current = JSON.parse(itemEditSnapshot(item));
  for (const path of paths) {
    if (typeof path === 'object') {
      const before = baseline.system?.advancement;
      const after = current.system?.advancement;
      const value = advancementSourceList(after).find((entry) => entry._id === path.advancementId);
      if (Array.isArray(before)) {
        const index = before.findIndex((entry) => entry._id === path.advancementId);
        if (index < 0) throw new Error('성장 항목의 저장 기준을 확인할 수 없습니다.');
        if (value) before[index] = structuredClone(value);
        else before.splice(
          index,
          1,
        );
        continue;
      }
      // dnd5e 5.3+: 원본은 ID를 키로 한 객체다.
      const key = before && Object.keys(before).find((id) => before[id]?._id === path.advancementId || id === path.advancementId);
      if (!key) throw new Error('성장 항목의 저장 기준을 확인할 수 없습니다.');
      if (value) before[key] = structuredClone(value);
      else delete before[key];
      continue;
    }
    const keys = path.replaceAll(
      '.-=',
      '.',
    ).split('.');
    let value = current;
    for (const key of keys) value = value?.[key];
    let target = baseline;
    let source = current;
    for (const key of keys.slice(
      0,
      -1,
    )) {
      if (value === undefined && target[key] == null) {
        target = null;
        break;
      }
      target = target[key] ??= {};
      source = source?.[key];
    }
    const key = keys.at(-1);
    if (!target) continue;
    if (source && Object.hasOwn(
      source,
      key,
    )) target[key] = structuredClone(source[key]);
    else delete target[key];
  }
  return JSON.stringify(baseline);
}
