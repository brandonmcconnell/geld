import { chmod, mkdir, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import type { z } from 'zod';
import type { pairingSchema } from './config';
export async function savePairing(folder: string, config: z.infer<typeof pairingSchema>): Promise<void> {
  await mkdir(folder, { recursive: true, mode: 0o700 });
  await chmod(folder, 0o700);
  const file = await open(
    join(folder, 'companion.json'),
    constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    await file.chmod(0o600);
    await file.truncate(0);
    await file.writeFile(JSON.stringify(config));
  } finally {
    await file.close();
  }
}
