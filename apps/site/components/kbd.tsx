/** Keyboard shortcut, one `<kbd>` per key. */
export function Kbd({ keys }: { readonly keys: readonly string[] }) {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      {keys.map((key, index) => (
        <span key={key} className="inline-flex items-center gap-1">
          {index > 0 ? <span aria-hidden="true">+</span> : null}
          <kbd>{key}</kbd>
        </span>
      ))}
    </span>
  );
}
