import { eq } from "drizzle-orm";
import { getDb } from "../../db";
import { user } from "../../db/schema";
import { type ReaderSettings, readerSettingsFrom } from "./settings";

/** The reader's Geld settings from their account, the ones the dashboard saves. */
export async function readGeldSettings(userId: string): Promise<ReaderSettings> {
  const [row] = await getDb()
    .select({ settings: user.settings })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  return readerSettingsFrom(row?.settings);
}
