import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const LOG_PATH =
  process.env.MOEWALLS_DEBUG_LOG ??
  join(homedir(), ".local/state/moewalls-cli/debug.log");

export class Logger {
  readonly path: string;
  #initialized = false;

  constructor(path = LOG_PATH) {
    this.path = path;
  }

  #formatPayload(data: unknown): string {
    if (data instanceof Error) {
      return `${data.name}: ${data.message}${data.stack ? `\n${data.stack}` : ""}`;
    }
    if (typeof data === "string") {
      return data;
    }
    if (data && typeof data === "object" && "stack" in data) {
      const record = data as { message?: unknown; stack?: unknown };
      const message =
        typeof record.message === "string" ? record.message : String(data);
      const stack = typeof record.stack === "string" ? `\n${record.stack}` : "";
      return `${message}${stack}`;
    }
    try {
      return JSON.stringify(data, null, 2);
    } catch {
      return String(data);
    }
  }

  init(): void {
    if (this.#initialized) {
      return;
    }
    this.#initialized = true;
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(
      this.path,
      `\n--- session ${new Date().toISOString()} pid=${process.pid} ---\n`,
    );
    this.debug("environment", {
      term: process.env.TERM,
      termProgram: process.env.TERM_PROGRAM,
      cols: process.stdout.columns,
      rows: process.stdout.rows,
      cwd: process.cwd(),
    });
  }

  debug(message: string, data?: unknown): void {
    this.init();
    const prefix = `${new Date().toISOString()} ${message}`;
    const line =
      data === undefined
        ? `${prefix}\n`
        : `${prefix}\n${this.#formatPayload(data)}\n`;
    appendFileSync(this.path, line);
  }

  error(label: string, error: unknown): void {
    this.debug(`ERROR [${label}]`, error);
  }

  installProcessHandlers(): void {
    this.init();
    process.on("uncaughtException", (error) => {
      this.error("uncaughtException", error);
    });
    process.on("unhandledRejection", (reason) => {
      this.error("unhandledRejection", reason);
    });
    process.on("exit", (code) => {
      this.debug(`process exit code=${code}`);
    });
  }

  writePathNotice(): void {
    process.stderr.write(`moewalls-cli debug log: ${this.path}\n`);
  }

  writeFatalNotice(error: unknown): void {
    process.stderr.write(
      `\nmoewalls-cli stopped unexpectedly. See log: ${this.path}\n`,
    );
    process.stderr.write(`${this.#formatPayload(error)}\n`);
  }
}

export const logger = new Logger();
  