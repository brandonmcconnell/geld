import code from 'posthog-js/dist/array.js?raw';

export async function loadMeasurementCode(): Promise<string> {
  return code;
}
