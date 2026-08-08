const SECRET_KEYS = /token|secret|apikey|api_key|authorization|password/i;

function redact(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(redact);
  const out = {};
  for (const [key, val] of Object.entries(value)) {
    out[key] = SECRET_KEYS.test(key) ? "[redacted]" : redact(val);
  }
  return out;
}

function emit(level, message, meta) {
  const line = {
    level,
    time: new Date().toISOString(),
    message,
    ...(meta ? redact(meta) : {}),
  };
  const text = JSON.stringify(line);
  if (level === "error") console.error(text);
  else if (level === "warn") console.warn(text);
  else console.log(text);
}

export const logger = {
  debug: (message, meta) => {
    if (process.env.LOG_LEVEL === "debug") emit("debug", message, meta);
  },
  info: (message, meta) => emit("info", message, meta),
  warn: (message, meta) => emit("warn", message, meta),
  error: (message, meta) => emit("error", message, meta),
};

export function timer() {
  const start = process.hrtime.bigint();
  return () => Math.round(Number(process.hrtime.bigint() - start) / 1e6);
}
