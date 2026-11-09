import { ProviderCiError, readProviderCiConfig } from './providers/config';
import { runProviderSummary } from './providers/summary';

void Promise.resolve().then(() => runProviderSummary(readProviderCiConfig(process.env))).then((result) => {
  console.info(`Geld summary ${result}.`);
}).catch((error: unknown) => {
  console.error(error instanceof ProviderCiError ? error.message : 'The provider summary could not be written.');
  process.exitCode = 1;
});
