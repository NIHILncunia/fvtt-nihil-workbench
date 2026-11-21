import {
  isActorWorkbenchOpen,
  toggleActorWorkbench,
} from './actor-workbench-app.mjs';
import { isWorkbenchOpen, toggleWorkbench } from './workbench-app.mjs';
import { openCompendiumWorkbench } from './compendium-workbench-app.mjs';

let launcher;
let LauncherClass;

export function openWorkbenchLauncher() {
  if (
    !['rDepyiOStMqbIYMg', 'rXB1GcSui4mDsgAn'].includes(
      globalThis.game?.user?.id,
    )
  )
    return null;
  if (!LauncherClass) {
    const { ApplicationV2, HandlebarsApplicationMixin } =
      globalThis.foundry.applications.api;
    LauncherClass = class extends HandlebarsApplicationMixin(ApplicationV2) {
      static DEFAULT_OPTIONS = {
        id: 'ncm-workbench-launcher',
        classes: ['ncm-workbench'],
        window: { title: '워크벤치', icon: 'fa-solid fa-hammer' },
        position: { width: 300, height: 'auto', left: 24, top: 140 },
        actions: {
          openCompendiumWorkbench: function (event) {
            event.preventDefault();
            openCompendiumWorkbench();
          },
          toggleItemWorkbench: async function (event) {
            event.preventDefault();
            await toggleWorkbench();
            await this.render({ force: true });
            this.bringToFront();
          },
          toggleActorWorkbench: async function (event) {
            event.preventDefault();
            await toggleActorWorkbench();
            await this.render({ force: true });
            this.bringToFront();
          },
        },
      };
      static PARTS = {
        main: {
          template:
            'modules/nihil-compendium-module/templates/workbench/launcher.hbs',
        },
      };

      async _prepareContext(options) {
        return {
          ...(await super._prepareContext(options)),
          itemOpen: isWorkbenchOpen(),
          actorOpen: isActorWorkbenchOpen(),
        };
      }

      refreshStates() {
        const states = {
          toggleItemWorkbench: isWorkbenchOpen(),
          toggleActorWorkbench: isActorWorkbenchOpen(),
        };
        for (const [action, open] of Object.entries(states)) {
          const button = this.element?.querySelector(`[data-action="${action}"]`);
          if (!button) continue;
          button.textContent = `${action === 'toggleItemWorkbench' ? '아이템' : '액터'} 워크벤치 ${open ? '닫기' : '열기'}`;
          button.setAttribute(
            'aria-pressed',
            String(open),
          );
        }
      }

      _onRender(
        context,
        options,
      ) {
        super._onRender(
          context,
          options,
        );
        this.element?.addEventListener(
          'pointerenter',
          () => this.refreshStates(),
        );
      }
    };
    globalThis.Hooks?.on(
      'ncmWorkbenchStateChanged',
      () => launcher?.refreshStates(),
    );
  }
  if (!launcher || launcher.state === LauncherClass.RENDER_STATES?.CLOSED)
    launcher = new LauncherClass();
  launcher.render({ force: true });
  return launcher;
}

export function injectSettingsWorkbenchButton(html) {
  if (
    !['rDepyiOStMqbIYMg', 'rXB1GcSui4mDsgAn'].includes(
      globalThis.game?.user?.id,
    )
  )
    return false;
  const root = html?.querySelector ? html : html?.[0];
  if (!root?.ownerDocument) return false;
  let button = root.querySelector('[data-action="open-ncm-workbench"]');
  if (!button) {
    button = root.ownerDocument.createElement('button');
    button.type = 'button';
    button.dataset.action = 'open-ncm-workbench';
    button.innerHTML = '<i class="fa-solid fa-hammer"></i> 워크벤치';
    button.addEventListener(
      'click',
      openWorkbenchLauncher,
    );
  }
  const resource = root.querySelector(
    '[data-action="open-luxterra-resource-manager"]',
  );
  if (resource) resource.before(button);
  else {
    const heading = Array.from(root.querySelectorAll('h2, h3')).find(
      (element) =>
        /게임 설정|Game Settings|Settings/i.test(element.textContent),
    );
    if (heading) heading.after(button);
    else root.querySelector('button')?.before(button);
  }
  return true;
}
