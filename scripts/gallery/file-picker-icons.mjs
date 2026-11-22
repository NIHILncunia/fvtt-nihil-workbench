import { openIconGallery } from './image-gallery-app.mjs';

function pickerRoot(html) {
  return html?.querySelector ? html : html?.[0];
}

// 코어 시트·활동·매크로·효과가 연 이미지 선택기에 같은 진입점을 붙인다.
export function injectFilePickerIconButton(
  picker,
  html,
  openGallery = openIconGallery,
) {
  if (!globalThis.game?.user?.isGM) return false;
  const type = picker?.type ?? picker?.options?.type;
  if (!['image', 'imagevideo'].includes(type)) return false;
  const root = pickerRoot(html) ?? pickerRoot(picker.element);
  if (!root || root.querySelector('.ncm-gallery__picker-icons')) return false;
  const bar = root.querySelector('.form-footer, .filepicker-footer, footer, .window-header') ?? root;
  const button = root.ownerDocument.createElement('button');
  button.type = 'button';
  button.className = 'ncm-gallery__picker-icons';
  button.textContent = '아이콘';
  button.addEventListener(
    'click',
    (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!globalThis.game?.user?.isGM) return;
      openGallery({
        current: picker.current ?? picker.options?.current ?? picker.field?.value ?? picker.options?.field?.value ?? picker.request ?? '',
        onSelect: async (url) => {
          // 코어처럼 대상 칸과 콜백을 함께 갱신한다. 비공개 속성에는 의존하지 않는다.
          const field = picker.field ?? picker.options?.field;
          if (field) {
            field.value = url;
            const EventClass = field.ownerDocument?.defaultView?.Event ?? globalThis.Event;
            field.dispatchEvent(new EventClass(
              'change',
              { bubbles: true, cancelable: true },
            ));
          }
          const callback = typeof picker.callback === 'function' ? picker.callback : picker.options?.callback;
          if (typeof callback === 'function') await callback.call(
            picker,
            url,
            picker,
          );
          await picker.close();
        },
        // 파일 선택기는 그대로 열려 있으므로 취소하거나 로컬로 돌아가도 입력을 보존한다.
        onPickLocal: () => picker.bringToFront?.(),
      });
    },
  );
  bar.append(button);
  return true;
}

const registeredHooks = new WeakMap();

export function registerFilePickerIconHooks() {
  const hooks = globalThis.Hooks;
  if (!hooks?.on) return false;
  let registered = registeredHooks.get(hooks);
  if (!registered) {
    registered = new Set();
    registeredHooks.set(
      hooks,
      registered,
    );
  }
  const classes = [globalThis.CONFIG?.ux?.FilePicker, globalThis.foundry?.applications?.apps?.FilePicker];
  const names = new Set(['renderFilePicker', ...classes.filter(Boolean).map((Class) => `render${Class.name}`)]);
  for (const name of names) {
    if (registered.has(name)) continue;
    hooks.on(
      name,
      (
        picker,
        html,
      ) => injectFilePickerIconButton(
        picker,
        html,
      ),
    );
    registered.add(name);
  }
  return true;
}
