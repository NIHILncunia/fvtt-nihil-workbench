const GUARDED = Symbol.for('nihil-compendium-module.autoanimations-world-effects');
const FUNCTIONS = {
  createActiveEffect: 'createActiveEffects',
  updateActiveEffect: 'toggleActiveEffects',
  preDeleteActiveEffect: 'deleteActiveEffects',
};

// AutoAnimations 6.5.2 dereferences a null Actor for library Item effects.
// Only those identified callbacks are wrapped; Actor animations and other hooks stay intact.
export function installAutoAnimationsWorldEffectGuard() {
  const module = globalThis.game?.modules?.get?.('autoanimations');
  if (!module?.active || module.version !== '6.5.2' || globalThis.game?.system?.id !== 'dnd5e')
    return 0;
  let installed = 0;
  for (const [hook, functionName] of Object.entries(FUNCTIONS)) {
    for (const entry of globalThis.Hooks?.events?.[hook] ?? []) {
      const original = entry.fn;
      if (typeof original !== 'function' || original[GUARDED]) continue;
      const code = Function.prototype.toString.call(original);
      if (!code.includes(`${functionName}(`) || !code.includes('game.user.id')) continue;
      const guarded = function (
        effect,
        ...args
      ) {
        const parent = effect?.parent;
        if (parent?.documentName !== 'Item' || parent.actor)
          return original.call(
            this,
            effect,
            ...args,
          );
        // Preserve AA's inherited animation flags without attempting a token animation.
        if (
          hook === 'createActiveEffect' &&
          globalThis.game.user.id === args[1] &&
          !globalThis.game.settings?.get?.(
            'autoanimations',
            'disableAEAnimations',
          )
        ) {
          const flags = parent.flags?.autoanimations;
          if (flags)
            return effect.update({
              'flags.autoanimations': structuredClone(flags),
            });
        }
        return undefined;
      };
      Object.defineProperty(
        guarded,
        GUARDED,
        {
          value: true,
        },
      );
      entry.fn = guarded;
      installed++;
    }
  }
  return installed;
}
