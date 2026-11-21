export function formInputEntries(form) {
  const counts = new Map();
  return Array.from(form?.querySelectorAll?.('input, textarea, select') ?? [])
    .filter(
      (control) =>
        !control.disabled &&
        !control.hasAttribute?.('data-complex-control') &&
        !control.hasAttribute?.('data-workbench-transient') &&
        !['browserSearch', 'browserType'].includes(control.name),
    )
    .map((control) => {
      const identity =
        control.name ||
        ['typePath', 'activityPath', 'activitySpecificPath', 'advancementPath']
          .map((key) => control.dataset?.[key])
          .find(Boolean) ||
        Object.keys(control.dataset ?? {})
          .sort()
          .join(',');
      const base = `${identity}:${control.type === 'checkbox' ? control.value : control.tagName}`;
      const index = counts.get(base) ?? 0;
      counts.set(
        base,
        index + 1,
      );
      return {
        key: `${base}:${index}`,
        control,
        value:
          control.type === 'checkbox'
            ? control.checked
            : control.multiple
              ? Array.from(control.selectedOptions).map(
                  (option) => option.value,
                )
              : control.value,
      };
    });
}

export function restoreFormInputs(
  form,
  values,
) {
  for (const { key, control } of formInputEntries(form)) {
    if (!values.has(key)) continue;
    const value = values.get(key);
    if (control.type === 'checkbox') control.checked = value;
    else if (control.multiple) {
      for (const option of control.options)
        option.selected = value.includes(option.value);
    } else control.value = value;
  }
}
