/** Toolbar icon variants: a black mark for light toolbars, a white mark for dark ones, and the black mark framed on white for toolbars of either. */

export const ACTION_ICON_SIZES = [16, 32, 48] as const;

export type ActionIconColor = 'black' | 'white' | 'framed';

export function actionIconPath(color: ActionIconColor, size: number): string {
  return `icon/action/${color}-${size}.png`;
}

/** `{ "16": "icon/action/black-16.png", ... }` as used by `action.default_icon` / `setIcon`. */
export function actionIconPaths(color: ActionIconColor): Record<string, string> {
  const paths: Record<string, string> = {};
  for (const size of ACTION_ICON_SIZES) paths[String(size)] = `/${actionIconPath(color, size)}`;
  return paths;
}
