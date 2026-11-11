import { createServerFn } from "@tanstack/react-start";
import type { ProviderConnection } from "./connections";

export const getProviderConnections = createServerFn({ method: "GET" }).handler(
  async (): Promise<ProviderConnection[]> => {
    const { getRequestSession } = await import("../auth-runtime");
    const session = await getRequestSession();
    if (!session) {
      return [];
    }
    const { listProviderConnections } = await import("./connections.server");
    return listProviderConnections(session.user.id);
  }
);
