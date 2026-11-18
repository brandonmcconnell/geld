import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import {
  assertPortsFree,
  assertToolchain,
  DASHBOARD_PORT,
  DevSetupError,
  dashboardDir,
  emulatorDir,
  runDevScript,
  runStep,
  waitForResponse,
  warmUpDashboard,
} from "./dev-env.mjs";

const EMULATOR_PORT = 4200;
const EMULATOR_URL = `http://localhost:${EMULATOR_PORT}`;
const demoStatePath = path.join(dashboardDir, ".wrangler/demo-state");
// Throwaway credentials that only work against the emulator.
const demoEnv = parseEnv(
  readFileSync(path.join(emulatorDir, "dashboard.env"), "utf8")
);
// The committed URL is the compose file's; a Postgres elsewhere is named in the shell.
demoEnv.DATABASE_URL =
  process.env.GELD_HUB_DEMO_DATABASE_URL ?? demoEnv.DATABASE_URL;
const reset = process.argv.includes("--reset");

async function waitForSeededEmulator(emulator) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const response = await waitForResponse(`${EMULATOR_URL}/_geld/health`, {
      timeoutMs: deadline - Date.now(),
      abandon: emulator.exited,
    });
    if (response.ok && (await response.json()).ready) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new DevSetupError("The GitHub emulator never finished seeding.");
}

runDevScript("dev:demo", async ({ log, supervisor }) => {
  assertToolchain();
  await assertPortsFree([
    { port: DASHBOARD_PORT, name: "dashboard" },
    { port: EMULATOR_PORT, name: "GitHub emulator" },
  ]);

  if (reset) {
    log("--reset: wiping the demo database and cache");
    rmSync(demoStatePath, { recursive: true, force: true });
  }
  runStep(
    "Preparing the demo database",
    ["run", "db:migrate", ...(reset ? ["--reset"] : [])],
    { cwd: dashboardDir, env: { DATABASE_URL: demoEnv.DATABASE_URL } }
  );

  log(`starting GitHub emulator on ${EMULATOR_URL}`);
  const emulator = supervisor.start(
    "emulator",
    "36",
    ["run", "start", ...(reset ? ["--reset"] : [])],
    { cwd: emulatorDir, env: { EMULATOR_PORT: String(EMULATOR_PORT) } }
  );
  await waitForSeededEmulator(emulator);

  log(`starting dashboard on port ${DASHBOARD_PORT}`);
  const dashboard = supervisor.start(
    "dashboard",
    "33",
    ["exec", "vite", "dev", "--port", String(DASHBOARD_PORT), "--strictPort"],
    { cwd: dashboardDir, env: { ...demoEnv, GELD_HUB_DEMO: "1" } }
  );
  await warmUpDashboard(log, dashboard);
  log('sign in: "Continue with GitHub", then pick "nova" in the emulator');
});
