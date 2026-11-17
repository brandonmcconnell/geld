/**
 * The digest's Chat button stands in the Geld row only once the owner turns it on, on every host alike: the chat
 * sidebar (`chat-sidebar.ts`) is built and kept working but offered nowhere until it is ready to show. Its own module,
 * since the sidebar's pulls in storage items, which a panel must not import (its tests run without the browser stub).
 */
export const CHAT_BUTTON_SHOWN = false;
