/** Wire a `button[role=switch]` to a boolean setting. */
export function bindSwitch(
  button: HTMLButtonElement,
  initial: boolean,
  onChange: (checked: boolean) => void | Promise<void>,
): { set(checked: boolean): void } {
  const set = (checked: boolean): void => {
    button.setAttribute('aria-checked', String(checked));
  };
  set(initial);
  button.addEventListener('click', () => {
    const next = button.getAttribute('aria-checked') !== 'true';
    set(next);
    void onChange(next);
  });
  return { set };
}

/** Look up an element by id, throwing early if the markup and script disagree. */
export function requireElement<T extends HTMLElement>(id: string, type: new () => T): T {
  const element = document.getElementById(id);
  if (!(element instanceof type)) {
    throw new Error(`Expected #${id} to be a ${type.name}`);
  }
  return element;
}
