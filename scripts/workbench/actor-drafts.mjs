import { buildActorWorkbenchUpdate } from './actor-adapter.mjs';
import { actorPathValue } from './actor-fields.mjs';
import { readTokenDetectionInputs } from './token-fields.mjs';
import { readHabitatInputs } from './actor-list-fields.mjs';

export function readActorControls(form) {
  const controls = Object.fromEntries(
    Array.from(
      form?.querySelectorAll?.(
        '[data-actor-edit], .ncm-actor-workbench__editor-form input[name], .ncm-actor-workbench__editor-form textarea[name], .ncm-actor-workbench__editor-form select[name]',
      ) ?? [],
    )
      .filter(
        (control) =>
          control.name &&
          ![
            'embeddedItemType',
            'embeddedItemName',
            'itemImportUuid',
            'effectName',
          ].includes(control.name),
      )
      .map((control) => [
        control.name,
        control.multiple
          ? Array.from(control.selectedOptions).map((option) => option.value)
          : control.type === 'checkbox'
            ? control.checked
            : control.value,
      ]),
  );
  const detection = readTokenDetectionInputs(form);
  if (detection) controls['field:prototypeToken.detectionModes'] = JSON.stringify(detection);
  const habitats = readHabitatInputs(form);
  if (habitats) controls['field:system.details.habitat.value'] = JSON.stringify(habitats);
  return controls;
}

export function actorControlsToForm(controls) {
  const fields = {};
  const result = {};
  const source = {};
  for (const [name, value] of Object.entries(controls)) {
    if (name.startsWith('field:')) fields[name.slice(6)] = value;
    else if (name.startsWith('source'))
      source[name.slice(6).toLowerCase()] = value;
    else result[{ actorName: 'name', actorImg: 'img' }[name] ?? name] = value;
  }
  if (Object.keys(source).length) result.source = source;
  result.fields = fields;
  return result;
}

export class ActorDraftStore {
  records = new Map();

  capture(
    actor,
    current,
    initial,
  ) {
    if (!actor?.toObject) return;
    let record = this.records.get(actor.id);
    for (const [name, value] of Object.entries(current)) {
      if (!(name in initial)) continue;
      if (JSON.stringify(value) === JSON.stringify(initial[name])) {
        if (record) delete record.values[name];
        continue;
      }
      record ??= { values: {}, source: actor.toObject() };
      record.values[name] = value;
    }
    if (record) {
      // Keep the original document snapshot for conflict detection and reverted edits.
      const baselineActor = {
        type: actor.type,
        system: actor.system,
        toObject: () => record.source,
      };
      try {
        if (
          !Object.keys(
            buildActorWorkbenchUpdate(
              baselineActor,
              actorControlsToForm(record.values),
            ),
          ).length
        )
          record = null;
      } catch {
        /* Invalid input is retained so the user can correct it. */
      }
    }
    if (record) this.records.set(
      actor.id,
      record,
    );
    else this.records.delete(actor.id);
  }

  prepare(actor) {
    const record = this.records.get(actor.id);
    if (!record) return { update: {}, conflicts: [] };
    const baselineActor = {
      type: actor.type,
      system: actor.system,
      toObject: () => record.source,
    };
    const requested = buildActorWorkbenchUpdate(
      baselineActor,
      actorControlsToForm(record.values),
    );
    const current = actor.toObject();
    const conflicts = Object.keys(requested).filter(
      (path) =>
        JSON.stringify(actorPathValue(
          current,
          path,
        )) !==
          JSON.stringify(actorPathValue(
            record.source,
            path,
          )) &&
        JSON.stringify(actorPathValue(
          current,
          path,
        )) !==
          JSON.stringify(requested[path]),
    );
    return { update: requested, conflicts };
  }
}
