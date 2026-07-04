const BACKEND_LOG_PATTERN =
  /playwright|chromium|Skipping host requirements|DevTools listening|browser has been closed/i;

type StreamWrite = typeof process.stderr.write;

function muteStreamWrite(original: StreamWrite): StreamWrite {
  return ((chunk, encoding, callback) => {
    const text =
      typeof chunk === "string"
        ? chunk
        : Buffer.isBuffer(chunk)
          ? chunk.toString(typeof encoding === "string" ? encoding : "utf8")
          : String(chunk);

    if (BACKEND_LOG_PATTERN.test(text)) {
      if (typeof encoding === "function") {
        (encoding as () => void)();
      } else if (typeof callback === "function") {
        callback();
      }
      return true;
    }

    if (typeof encoding === "function") {
      return original(chunk, encoding);
    }

    return original(
      chunk,
      encoding as BufferEncoding,
      callback as (error?: Error | null) => void,
    );
  }) as StreamWrite;
}

export async function withMutedBackendLogs<T>(fn: () => Promise<T>): Promise<T> {
  const stderrWrite = process.stderr.write;
  const stdoutWrite = process.stdout.write;

  process.stderr.write = muteStreamWrite(stderrWrite.bind(process.stderr));
  process.stdout.write = muteStreamWrite(stdoutWrite.bind(process.stdout));

  try {
    return await fn();
  } finally {
    process.stderr.write = stderrWrite;
    process.stdout.write = stdoutWrite;
  }
}
