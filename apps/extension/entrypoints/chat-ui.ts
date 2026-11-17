import { registerChatUi } from '../src/chat/loader';
import { mountChat } from '../src/chat/mount';

/** The chat sidebar's view, injected into a GitHub tab's isolated world by the background when the sidebar first opens. */
export default defineUnlistedScript(() => {
  registerChatUi({ mountChat });
});
