const viewStates = new WeakMap();
const layoutSelector = '[data-workbench-layout]';
const controlSelector = 'button, input, select, textarea, summary, [tabindex]';

export function workbenchFolderPath(folder) {
  const folders = [];
  const seen = new Set();
  while (folder?.id && !seen.has(folder.id)) {
    seen.add(folder.id);
    folders.unshift({ id: folder.id, name: folder.name });
    folder = folder.folder;
  }
  const current = folders.at(-1);
  return {
    current: current ? { ...current, current: true } : null,
    parent: folders.at(-2) ?? null,
    middle: folders.slice(0, -2),
    ancestors: folders.slice(0, -1),
  };
}

function viewState(app) {
  if (!viewStates.has(app)) {
    viewStates.set(app, {
      pane: 'list',
      focusAfterRender: null,
      paneFocus: new Map(),
      lastFocus: null,
      snapshot: null,
    });
  }
  return viewStates.get(app);
}

function describeFocus(root, element) {
  if (!element || !root.contains(element)) return null;
  const region = element.closest('[data-workbench-menu], [data-workbench-panel]') ?? root;
  const regionKey = region === root
    ? null
    : region.hasAttribute('data-workbench-menu')
      ? ['data-workbench-menu', region.dataset.workbenchMenu]
      : ['data-workbench-panel', region.dataset.workbenchPanel];
  const attributes = Array.from(element.attributes)
    .filter(({ name }) => name === 'name' || name === 'id' || name.startsWith('data-'))
    .map(({ name, value }) => [name, value]);
  const { tagName } = element;
  const matches = (candidate) => candidate.tagName === tagName
    && attributes.every(([name, value]) => candidate.getAttribute(name) === value);
  const peers = [region, ...region.querySelectorAll(controlSelector)].filter(matches);
  return { regionKey, matches, index: peers.indexOf(element) };
}

function findFocus(root, description) {
  if (!description) return null;
  const { regionKey, matches, index } = description;
  const region = regionKey
    ? root.querySelector(`[${regionKey[0]}="${regionKey[1]}"]`)
    : root;
  if (!region) return null;
  const peers = [region, ...region.querySelectorAll(controlSelector)].filter(matches);
  const target = peers[index];
  return target?.getClientRects().length && getComputedStyle(target).visibility === 'visible'
    ? target
    : null;
}

function saveLayout(app) {
  const root = app.element?.querySelector?.(layoutSelector);
  if (!root) return;
  const state = viewState(app);
  const active = root.ownerDocument.activeElement;
  state.snapshot = {
    focus: describeFocus(root, active),
    menus: Array.from(root.querySelectorAll('[data-workbench-menu][open]'), (menu) => [
      menu.dataset.workbenchMenu,
      menu.querySelector('.ncm-workbench__menu-panel').scrollTop,
    ]),
    scroll: Array.from(root.querySelectorAll('[data-workbench-scroll]'), (area) => [
      area.dataset.workbenchScroll,
      area.scrollTop,
    ]),
  };
}

export const WorkbenchLayoutMixin = (Base) => class extends Base {
  async _preRender(
    context,
    options,
  ) {
    saveLayout(this);
    await super._preRender(
      context,
      options,
    );
  }
};

export function focusWorkbenchOnRender(app) {
  if (!app) return;
  const state = viewState(app);
  state.restoreLastFocus = true;
}

export function restoreWorkbenchOnClose(app, child, target) {
  if (!child?.addEventListener) return;
  const root = app.element?.querySelector?.(layoutSelector);
  const previous = root ? describeFocus(root, target) : null;
  child.addEventListener('close', () => {
    const current = app.element?.querySelector?.(layoutSelector);
    if (!current) return;
    app.bringToFront?.();
    findFocus(current, previous)?.focus({ preventScroll: true });
  }, { once: true });
}

export function showWorkbenchForm(app, { force = false } = {}) {
  const layout = app.element?.querySelector?.(layoutSelector);
  if (!force && !layout?.querySelector('[data-workbench-show="form"]')?.getClientRects?.().length) return;
  const state = viewState(app);
  state.pane = 'form';
  state.focusAfterRender = '[data-workbench-panel="form"]';
}

export function focusWorkbenchPath(app) {
  viewState(app).focusAfterRender = '.ncm-workbench__path [aria-current="location"]';
}

export function bindWorkbenchLayout(app) {
  const root = app.element?.querySelector?.(layoutSelector);
  if (!root) return;
  const state = viewState(app);
  const toggles = Array.from(root.querySelectorAll('[data-workbench-show]'));
  const panels = Object.fromEntries(
    Array.from(root.querySelectorAll('[data-workbench-panel]'), (panel) => [panel.dataset.workbenchPanel, panel]),
  );
  const menus = root.querySelectorAll('[data-workbench-menu]');

  const focus = (target) => target?.focus({ preventScroll: true });
  const closeMenu = (menu, restoreFocus = false) => {
    menu.open = false;
    if (restoreFocus) focus(menu.querySelector('summary'));
  };
  const syncPane = () => {
    root.dataset.workbenchPane = state.pane;
    for (const toggle of toggles) {
      toggle.setAttribute('aria-pressed', String(toggle.dataset.workbenchShow === state.pane));
    }
  };
  syncPane();
  for (const panel of Object.values(panels)) panel.tabIndex = -1;
  const snapshot = state.snapshot;
  state.snapshot = null;
  for (const [key, position] of snapshot?.scroll ?? []) {
    const area = root.querySelector(`[data-workbench-scroll="${key}"]`);
    if (area) area.scrollTop = position;
  }
  for (const [key, position] of snapshot?.menus ?? []) {
    const menu = root.querySelector(`[data-workbench-menu="${key}"]`);
    if (!menu?.getClientRects().length) continue;
    menu.open = true;
    menu.querySelector('.ncm-workbench__menu-panel').scrollTop = position;
  }
  const restored = state.focusAfterRender
    ? root.querySelector(state.focusAfterRender)
    : findFocus(root, state.restoreLastFocus ? state.lastFocus : snapshot?.focus);
  state.focusAfterRender = null;
  state.restoreLastFocus = false;

  for (const menu of menus) {
    menu.addEventListener('toggle', () => {
      if (!menu.open) return;
      const panel = menu.querySelector('.ncm-workbench__menu-panel');
      panel.style.translate = '';
      panel.style.maxHeight = '';
      const bounds = root.getBoundingClientRect();
      const rect = panel.getBoundingClientRect();
      const left = Math.max(bounds.left + 4, Math.min(rect.left, bounds.right - rect.width - 4));
      panel.style.translate = (left - rect.left) + 'px';
      panel.style.maxHeight = Math.min(220, Math.max(0, bounds.bottom - rect.top - 4)) + 'px';
    });
  }

  root.addEventListener('focusin', (event) => {
    const pane = event.target.closest('[data-workbench-panel]')?.dataset.workbenchPanel;
    const description = describeFocus(root, event.target);
    state.lastFocus = description;
    if (pane) state.paneFocus.set(pane, description);
    for (const menu of menus) {
      if (menu.open && !menu.contains(event.target)) closeMenu(menu);
    }
  });
  root.addEventListener('pointerdown', (event) => {
    for (const menu of menus) {
      if (menu.open && !menu.contains(event.target)) closeMenu(menu);
    }
  });
  root.addEventListener('click', (event) => {
    const toggle = event.target.closest('[data-workbench-show]');
    if (toggle) {
      const pane = toggle.dataset.workbenchShow;
      if (pane === state.pane) return;
      state.pane = pane;
      syncPane();
      const selected = pane === 'list' ? panels.list.querySelector('button.is-selected') : null;
      focus(findFocus(root, state.paneFocus.get(pane)) ?? selected ?? panels[pane]);
      return;
    }
    const menu = event.target.closest('[data-workbench-menu]');
    if (menu && event.target.closest('button[data-action]:not(:disabled)')) closeMenu(menu, true);
  });
  focus(restored);

  root.addEventListener('keydown', (event) => {
    if (event.isComposing) return;
    const menu = event.target.closest('[data-workbench-menu][open]');
    if (!menu) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeMenu(menu, true);
    }
    if (event.key === 'Tab') {
      const controls = Array.from(menu.querySelectorAll('summary, button:not(:disabled)'))
        .filter((control) => control.getClientRects().length);
      const index = controls.indexOf(event.target);
      const next = controls[index + (event.shiftKey ? -1 : 1)];
      if (index >= 0 && next) {
        event.preventDefault();
        focus(next);
      }
    }
  });
}
