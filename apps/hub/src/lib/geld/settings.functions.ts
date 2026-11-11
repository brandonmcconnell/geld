import { DEFAULT_SETTINGS } from "@geld/core/settings";
import { createServerFn } from "@tanstack/react-start";
import type { ReaderSettings } from "./settings";

export const getGeldSettings = createServerFn({ method: "GET" }).handler(
  async (): Promise<ReaderSettings> => {
    const { getRequestSession } = await import("../auth-runtime");
    const session = await getRequestSession();
    if (!session) {
      return { settings: DEFAULT_SETTINGS, invalid: false };
    }
    const { readGeldSettings } = await import("./settings.server");
    return readGeldSettings(session.user.id);
  }
);
