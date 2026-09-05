/** Toolbar icon variants: a black mark for light toolbars, a white mark for dark ones. */

export const ACTION_ICON_SIZES = [16, 32, 48] as const;

export type ActionIconColor = 'black' | 'white';

export function actionIconPath(color: ActionIconColor, size: number): string {
  return `icon/action/${color}-${size}.png`;
}

/** `{ "16": "icon/action/black-16.png", ... }` as used by `action.default_icon` / `setIcon`. */
export function actionIconPaths(color: ActionIconColor): Record<string, string> {
  const paths: Record<string, string> = {};
  for (const size of ACTION_ICON_SIZES) paths[String(size)] = `/${actionIconPath(color, size)}`;
  return paths;
}
