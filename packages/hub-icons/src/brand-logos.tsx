import type * as React from "react";

function withClassName(className?: string) {
  return className ? `shrink-0 ${className}` : "shrink-0";
}

// Source: https://api.svgl.app?search=github
// Asset:
// - https://svgl.app/library/github_light.svg
export function GitHubLogo(props: React.ComponentProps<"svg">) {
  const { className, ...rest } = props;

  return (
    <svg
      aria-hidden="true"
      className={withClassName(className)}
      fill="none"
      focusable="false"
      viewBox="0 0 1024 1024"
      xmlns="http://www.w3.org/2000/svg"
      {...rest}
    >
      <path
        clipRule="evenodd"
        d="M512 0C229.12 0 0 229.12 0 512c0 226.56 146.56 417.92 350.08 485.76 25.6 4.48 35.2-10.88 35.2-24.32 0-12.16-.64-52.48-.64-95.36-128.64 23.68-161.92-31.36-172.16-60.16-5.76-14.72-30.72-60.16-52.48-72.32-17.92-9.6-43.52-33.28-.64-33.92 40.32-.64 69.12 37.12 78.72 52.48 46.08 77.44 119.68 55.68 149.12 42.24 4.48-33.28 17.92-55.68 32.64-68.48-113.92-12.8-232.96-56.96-232.96-252.8 0-55.68 19.84-101.76 52.48-137.6-5.12-12.8-23.04-65.28 5.12-135.68 0 0 42.88-13.44 140.8 52.48 40.96-11.52 84.48-17.28 128-17.28s87.04 5.76 128 17.28c97.92-66.56 140.8-52.48 140.8-52.48 28.16 70.4 10.24 122.88 5.12 135.68 32.64 35.84 52.48 81.28 52.48 137.6 0 196.48-119.68 240-233.6 252.8 18.56 16 34.56 46.72 34.56 94.72 0 68.48-.64 123.52-.64 140.8 0 13.44 9.6 29.44 35.2 24.32C877.44 929.92 1024 737.92 1024 512 1024 229.12 794.88 0 512 0"
        fill="currentColor"
        fillRule="evenodd"
      />
    </svg>
  );
}

// Source: https://svgl.app/library/gitlab.svg — official tanuki, flattened to
// currentColor so it sits beside the other mono platform marks.
export function GitLabLogo(props: React.ComponentProps<"svg">) {
  const { className, ...rest } = props;
  return (
    <svg
      aria-hidden="true"
      className={withClassName(className)}
      fill="none"
      focusable="false"
      viewBox="0 0 32 32"
      xmlns="http://www.w3.org/2000/svg"
      {...rest}
    >
      <path
        d="m31.46 12.78-.04-.12-4.35-11.35A1.14 1.14 0 0 0 25.94.6c-.24 0-.47.1-.66.24-.19.15-.33.36-.39.6l-2.94 9h-11.9l-2.94-9A1.14 1.14 0 0 0 6.07.58a1.15 1.15 0 0 0-1.14.72L.58 12.68l-.05.11a8.1 8.1 0 0 0 2.68 9.34l.02.01.04.03 6.63 4.97 3.28 2.48 2 1.52a1.35 1.35 0 0 0 1.62 0l2-1.52 3.28-2.48 6.67-5h.02a8.09 8.09 0 0 0 2.7-9.36Z"
        fill="currentColor"
      />
    </svg>
  );
}

