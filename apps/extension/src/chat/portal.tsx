import * as React from 'react';

/**
 * Where menus and tooltips render. Base UI portals to `document.body` by default, outside the chat's shadow root,
 * where none of its styles reach, so every portal takes this container inside the shadow root instead.
 */
export const PortalContainer = React.createContext<HTMLElement | null>(null);

export function usePortalContainer(): HTMLElement | null {
  return React.useContext(PortalContainer);
}
