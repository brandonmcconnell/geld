/** Toolbar icons: the mark framed on a white plate, which reads on any toolbar, and Safari's bare black template mark. */

export const ACTION_ICON_SIZES = [16, 32, 48] as const;

export type ActionIconKind = 'framed' | 'template';

export function actionIconPath(kind: ActionIconKind, size: number): string {
  return kind === 'framed' ? `icon/action/${size}.png` : `icon/action/black-${size}.png`;
}

/** `{ "16": "icon/action/16.png", ... }` as used by `action.default_icon`. */
export function actionIconPaths(kind: ActionIconKind): Record<string, string> {
  const paths: Record<string, string> = {};
  for (const size of ACTION_ICON_SIZES) paths[String(size)] = actionIconPath(kind, size);
  return paths;
}
