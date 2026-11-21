import { isWorkbenchUser } from './shared/workbench-access.mjs';
import { openStatblockImporter } from './statblock-importer/importer.mjs';
import {
  openActorWorkbench,
  refreshActorWorkbench,
  syncDeletedActor,
  syncDeletedActorFolder,
  syncUpdatedActor,
} from './workbench/actor-workbench-app.mjs';
import {
  openWorkbench,
  refreshWorkbench,
  syncDeletedFolder,
  syncUpdatedItem,
  syncUpdatedItemEffect,
} from './workbench/workbench-app.mjs';
import { injectSettingsWorkbenchButton, openWorkbenchLauncher } from './workbench/launcher-app.mjs';
import { installAutoAnimationsWorldEffectGuard } from './workbench/autoanimations-compat.mjs';
import { openCompendiumWorkbench, refreshCompendiumWorkbench } from './workbench/compendium-workbench-app.mjs';
import { content } from './content/index.mjs';
import { examples } from './content/examples/ranged-fire.mjs';

const MODULE_ID = 'nihil-compendium-module';
const PRIVILEGED_USER_IDS = new Set(['rDepyiOStMqbIYMg', 'rXB1GcSui4mDsgAn']);
let contextHookRegistered = false;
let itemDirectoryRenderHookRegistered = false;
let documentSyncHooksRegistered = false;
let actorContextHookRegistered = false;
let actorDirectoryRenderHookRegistered = false;
let settingsRenderHookRegistered = false;
const deletedFolderParents = new Map();
const deletedActorFolderParents = new Map();
const ITEM_DIRECTORY_PATCH = Symbol.for(`${MODULE_ID}.item-directory-context`);
const ACTOR_DIRECTORY_PATCH = Symbol.for(`${MODULE_ID}.actor-directory-context`);

function registerApi() {
  const module = globalThis.game?.modules?.get(MODULE_ID);
  if (!module) return false;

  module.api = {
    ...(module.api ?? {}),
    openStatblockImporter,
    openActorWorkbench,
    openWorkbench,
    openWorkbenchLauncher,
    openCompendiumWorkbench,
    content,
    examples,
  };
  return true;
}


function canUseWorkbenchLauncher() {
  return PRIVILEGED_USER_IDS.has(globalThis.game?.user?.id) || isWorkbenchUser();
}

function injectItemDirectoryWorkbenchButton(html) {
  if (!canUseWorkbenchLauncher()) return false;
  const root = html?.querySelector ? html : html?.[0];
  const footer = root?.querySelector?.('.directory-footer');
  if (!footer || footer.querySelector('.ncm-open-workbench')) return false;

  const referenceButton = footer.querySelector('button');
  const button = root.ownerDocument.createElement('button');
  button.type = 'button';
  button.className = `${referenceButton?.className ?? ''} ncm-open-workbench`.trim();
  button.innerHTML = '<i class="fa-solid fa-hammer"></i><span>Nihil Workbench</span>';
  button.addEventListener('click', () => openWorkbench());
  footer.append(button);
  return true;
}

function injectActorDirectoryWorkbenchButton(html) {
  if (!canUseWorkbenchLauncher()) return false;
  const root = html?.querySelector ? html : html?.[0];
  const footer = root?.querySelector?.('.directory-footer');
  if (!footer || footer.querySelector('.ncm-open-actor-workbench')) return false;

  const referenceButton = footer.querySelector('button');
  const button = root.ownerDocument.createElement('button');
  button.type = 'button';
  button.className = `${referenceButton?.className ?? ''} ncm-open-actor-workbench`.trim();
  button.innerHTML = '<i class="fa-solid fa-hammer"></i><span>Nihil Workbench</span>';
  button.addEventListener('click', () => openActorWorkbench());
  footer.append(button);
  return true;
}

function registerWorkbenchDocumentSyncHooks() {
  if (documentSyncHooksRegistered || !globalThis.Hooks?.on) return false;
  globalThis.Hooks.on('createFolder', (folder) => {
    if (folder.pack) return refreshCompendiumWorkbench();
    if (folder?.type === 'Item') refreshWorkbench();
  });
  globalThis.Hooks.on('updateFolder', (folder) => {
    if (folder.pack) return refreshCompendiumWorkbench();
    if (folder?.type === 'Item') refreshWorkbench();
  });
  globalThis.Hooks.on('preDeleteFolder', (folder) => {
    if (folder.pack) return;
    if (folder?.type !== 'Item') return;
    deletedFolderParents.set(folder.id, folder.folder?.id ?? folder._source?.folder ?? null);
  });
  globalThis.Hooks.on('deleteFolder', (folder) => {
    if (folder.pack) return refreshCompendiumWorkbench();
    if (folder?.type !== 'Item') return;
    const parentFolderId = deletedFolderParents.get(folder.id) ?? folder.folder?.id ?? folder._source?.folder ?? null;
    deletedFolderParents.delete(folder.id);
    syncDeletedFolder(folder.id, parentFolderId);
  });
  globalThis.Hooks.on(
    'createItem',
    (item) => {
    refreshWorkbench();
    if (item?.parent?.documentName === 'Actor') refreshActorWorkbench();
  }
  );
  globalThis.Hooks.on('updateItem', (item) => {
    syncUpdatedItem(item);
    if (item?.parent?.documentName === 'Actor') refreshActorWorkbench();
  });
  for (const hook of ['createActiveEffect', 'updateActiveEffect', 'deleteActiveEffect']) {
    globalThis.Hooks.on(
      hook,
      (effect) => {
        const parent = effect?.parent;
        if (parent?.documentName === 'Item') {
          syncUpdatedItemEffect(parent);
          if (parent.parent?.documentName === 'Actor') refreshActorWorkbench();
        } else if (parent?.documentName === 'Actor') {
          refreshActorWorkbench();
        }
      },
    );
  }
  globalThis.Hooks.on(
    'deleteItem',
    (item) => {
    refreshWorkbench();
    if (item?.parent?.documentName === 'Actor') refreshActorWorkbench();
  }
  );
  globalThis.Hooks.on('createActor', () => {
    refreshActorWorkbench();
  });
  globalThis.Hooks.on('updateActor', (actor) => {
    syncUpdatedActor(actor);
  });
  globalThis.Hooks.on('deleteActor', (actor) => {
    syncDeletedActor(
      actor.id,
      actor.folder?.id ?? null,
      actor.pack,
    );
  });
  globalThis.Hooks.on('createFolder', (folder) => {
    if (folder.pack) return refreshCompendiumWorkbench();
    if (folder?.type === 'Actor') refreshActorWorkbench();
  });
  globalThis.Hooks.on('updateFolder', (folder) => {
    if (folder.pack) return refreshCompendiumWorkbench();
    if (folder?.type === 'Actor') refreshActorWorkbench();
  });
  globalThis.Hooks.on('preDeleteFolder', (folder) => {
    if (folder.pack) return;
    if (folder?.type !== 'Actor') return;
    deletedActorFolderParents.set(folder.id, folder.folder?.id ?? folder._source?.folder ?? null);
  });
  globalThis.Hooks.on('deleteFolder', (folder) => {
    if (folder.pack) return refreshCompendiumWorkbench();
    if (folder?.type !== 'Actor') return;
    const parentFolderId = deletedActorFolderParents.get(folder.id) ?? folder.folder?.id ?? folder._source?.folder ?? null;
    deletedActorFolderParents.delete(folder.id);
    syncDeletedActorFolder(folder.id, parentFolderId);
  });
  documentSyncHooksRegistered = true;
  return true;
}

function registerItemDirectoryRenderHook() {
  if (itemDirectoryRenderHookRegistered || !globalThis.Hooks?.on) return false;
  globalThis.Hooks.on('renderItemDirectory', (_app, html) => {
    injectItemDirectoryWorkbenchButton(html);
  });
  itemDirectoryRenderHookRegistered = true;
  return true;
}

function registerActorDirectoryRenderHook() {
  if (actorDirectoryRenderHookRegistered || !globalThis.Hooks?.on) return false;
  globalThis.Hooks.on('renderActorDirectory', (_app, html) => {
    injectActorDirectoryWorkbenchButton(html);
  });
  actorDirectoryRenderHookRegistered = true;
  return true;
}

function registerSettingsRenderHook() {
  if (settingsRenderHookRegistered || !globalThis.Hooks?.on) return false;
  globalThis.Hooks.on(
    'renderSettings',
    (
      _app,
      html
    ) => {
    injectSettingsWorkbenchButton(html);
    // The resource manager may insert its button later in the same hook dispatch.
    queueMicrotask(() => injectSettingsWorkbenchButton(html));
  }
  );
  settingsRenderHookRegistered = true;
  return true;
}

function contextDocumentId(entry) {
  if (typeof entry?.data === 'function') {
    return entry.data('documentId') ?? entry.data('entryId') ?? null;
  }
  const element = entry?.[0] ?? entry;
  return element?.dataset?.documentId ?? element?.dataset?.entryId ?? null;
}

function workbenchContextOption() {
  return {
    label: 'Nihil Workbench에서 편집',
    icon: '<i class="fa-solid fa-hammer"></i>',
    visible: (entry) => {
      const itemId = contextDocumentId(entry);
      const item = itemId ? globalThis.game?.items?.get?.(itemId) : null;
      return Boolean(item && (item.isOwner ?? globalThis.game?.user?.isGM));
    },
    onClick: (_event, entry) => {
      const itemId = contextDocumentId(entry);
      if (itemId) openWorkbench(itemId);
    },
  };
}

function actorWorkbenchContextOption() {
  return {
    label: 'Nihil Workbench에서 편집',
    icon: '<i class="fa-solid fa-hammer"></i>',
    visible: (entry) => {
      if (!canUseWorkbenchLauncher()) return false;
      const actorId = contextDocumentId(entry);
      const actor = actorId ? globalThis.game?.actors?.get?.(actorId) : null;
      return Boolean(
        actor
        && ['character', 'npc'].includes(actor.type)
        && (actor.isOwner ?? globalThis.game?.user?.isGM),
      );
    },
    onClick: (_event, entry) => {
      const actorId = contextDocumentId(entry);
      if (actorId) openActorWorkbench({ actorId });
    },
  };
}

function registerContextHook() {
  if (contextHookRegistered || !globalThis.Hooks?.on) return false;
  for (const hook of ['getItemDirectoryEntryContext', 'getItemContextOptions']) {
    globalThis.Hooks.on(hook, (_application, contextOptions) => {
      if (!Array.isArray(contextOptions)) return;
      if (contextOptions.some(option => (option?.label ?? option?.name) === 'Nihil Workbench에서 편집')) return;
      contextOptions.push(workbenchContextOption());
    });
  }
  contextHookRegistered = true;
  return true;
}

function registerActorContextHook() {
  if (actorContextHookRegistered || !globalThis.Hooks?.on) return false;
  for (const hook of ['getActorDirectoryEntryContext', 'getActorContextOptions']) {
    globalThis.Hooks.on(hook, (_application, contextOptions) => {
      if (!Array.isArray(contextOptions)) return;
      if (contextOptions.some(option => (option?.label ?? option?.name) === 'Nihil Workbench에서 편집')) return;
      contextOptions.push(actorWorkbenchContextOption());
    });
  }
  actorContextHookRegistered = true;
  return true;
}

function patchContextOptionTarget(
  target,
  patchMarker = ITEM_DIRECTORY_PATCH,
  contextOption = workbenchContextOption,
) {
  if (!target || typeof target._getEntryContextOptions !== 'function') return false;
  if (target[patchMarker]) return true;

  const original = target._getEntryContextOptions;
  target._getEntryContextOptions = function(...args) {
    const options = original.apply(this, args) ?? [];
    if (!options.some(option => (option?.label ?? option?.name) === 'Nihil Workbench에서 편집')) {
      options.push(contextOption());
    }
    return options;
  };
  Object.defineProperty(target, patchMarker, { value: true, configurable: true });
  return true;
}

function patchItemDirectoryContextMenu() {
  const prototype = globalThis.CONFIG?.ui?.items?.prototype;
  const directory = globalThis.ui?.items;
  const prototypePatched = patchContextOptionTarget(prototype);
  const directoryPatched = patchContextOptionTarget(directory);
  return prototypePatched || directoryPatched;
}

function patchActorDirectoryContextMenu() {
  const prototype = globalThis.CONFIG?.ui?.actors?.prototype;
  const directory = globalThis.ui?.actors;
  const prototypePatched = patchContextOptionTarget(prototype, ACTOR_DIRECTORY_PATCH, actorWorkbenchContextOption);
  const directoryPatched = patchContextOptionTarget(directory, ACTOR_DIRECTORY_PATCH, actorWorkbenchContextOption);
  return prototypePatched || directoryPatched;
}

registerApi();
registerContextHook();
registerActorContextHook();
registerItemDirectoryRenderHook();
registerActorDirectoryRenderHook();
registerSettingsRenderHook();
registerWorkbenchDocumentSyncHooks();
patchItemDirectoryContextMenu();
patchActorDirectoryContextMenu();
globalThis.Hooks?.once?.('init', () => {
  registerApi();
  registerContextHook();
  registerActorContextHook();
  registerItemDirectoryRenderHook();
  registerActorDirectoryRenderHook();
  registerSettingsRenderHook();
  registerWorkbenchDocumentSyncHooks();
});
globalThis.Hooks?.once?.('ready', () => {
  registerApi();
  patchItemDirectoryContextMenu();
  patchActorDirectoryContextMenu();
  queueMicrotask(installAutoAnimationsWorldEffectGuard);
});
globalThis.Hooks?.on?.(
  'aa.initialize',
  installAutoAnimationsWorldEffectGuard,
);
globalThis.Hooks?.on?.(
  'updateCompendium',
  refreshCompendiumWorkbench,
);
globalThis.Hooks?.on?.(
  'updateSetting',
  (setting) => {
    if (setting.key === 'core.compendiumConfiguration') refreshCompendiumWorkbench();
  },
);
