import { logger } from "./logger.ts";
import { createMoewallsApp, shutdownMoewallsApp } from "./tui/index.ts";

const runtimeMode = (
  process.env.MOEWALLS_RUNTIME_MODE ?? "production"
).toLowerCase();
const isDevelopmentMode =
  runtimeMode === "development" || runtimeMode === "dev";

logger.installProcessHandlers();

function flushTerminal(): void {
  if (!process.stdout.isTTY) {
    return;
  }
  process.stdout.write("\x1b[2J\x1b[3J\x1b[H");
}

function ensureInteractiveTerminal(): void {
  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    logger.init();
    logger.error("startup", "not an interactive TTY");
    console.error(
      "moewalls-cli requires an interactive terminal (TTY).\n" +
        "Run it directly in your terminal: bun run start",
    );
    process.exit(1);
  }
}

ensureInteractiveTerminal();
flushTerminal();
logger.init();
if (isDevelopmentMode) {
  logger.writePathNotice();
}
logger.debug("starting app");

const app = createMoewallsApp();

try {
  await app.run();
  logger.debug("app.run finished");
} catch (error) {
  logger.error("app.run", error);
  logger.writeFatalNotice(error);
  process.exitCode = 1;
} finally {
  await shutdownMoewallsApp();
  logger.debug("shutdown complete");
}
