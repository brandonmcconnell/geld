export function Brand({ compact = false }: { readonly compact?: boolean }) {
  return (
    <span className="brand">
      <svg aria-hidden="true" viewBox="0 0 23.29 24.02" width="23" height="24" fill="currentColor">
        <path d="m23.28 0h-17.7l-5.58 5.42v18.6h17.86l5.43-5.37v-8.43h-3.76v6.78l-3.47 3.28h-12.19v-13.11l3.48-3.42h15.93v-3.75z" />
        <path d="m19.55 6.57h-10.57l-2.08 1.99v8.93h7.63l1.82-1.83v-2.26h-5.46v-3.04h8.66v-3.79z" />
      </svg>
      {!compact && (
        <span className="brand-name">
          geld<span className="brand-dot">.</span>
        </span>
      )}
    </span>
  );
}
