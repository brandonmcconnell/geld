export function Brand({ compact = false }: { readonly compact?: boolean }) {
  return (
    <span className="brand">
      <svg aria-hidden="true" viewBox="0 0 24 25" width="23" height="24" fill="currentColor" className="dark:hidden">
        <path d="M24 0H6L0 6V25H18L24 19V7H9L7 9V18H15L17 16V14H11V11H20V17L16 21H4V8L8 4H24Z" />
      </svg>
      {/* The emblem's dark-mode cut, lighter, since light on dark reads bolder. */}
      <svg aria-hidden="true" viewBox="0 0 24 25" width="23" height="24" fill="currentColor" className="hidden dark:block">
        <path d="M23.8 0.2L6.083 0.2L0.2 6.083L0.2 24.8L17.917 24.8L23.8 18.917L23.8 7.2L9.083 7.2L7.2 9.083L7.2 17.8L14.917 17.8L16.8 15.917L16.8 14.2L10.8 14.2L10.8 10.8L20.2 10.8L20.2 17.083L16.083 21.2L3.8 21.2L3.8 7.917L7.917 3.8L23.8 3.8Z" />
      </svg>
      {!compact && (
        <span className="brand-name">
          geld<span className="brand-dot">.</span>
        </span>
      )}
    </span>
  );
}
