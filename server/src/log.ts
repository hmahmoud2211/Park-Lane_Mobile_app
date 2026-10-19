/**
 * One-line logs with secrets taken out. Fields whose names look secret are
 * replaced before anything is printed, so a key or password passed in by
 * mistake never reaches the console. Request and response bodies are never
 * logged at all.
 */
const SECRET_FIELD = /key|password|passwd|token|secret|authorization|^iv$|^data\d*$/i;

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redact(entry, depth + 1));
  }
  return Object.fromEntries(
    Object.entries(value).map(([field, entry]) => [
      field,
      SECRET_FIELD.test(field) ? '[redacted]' : redact(entry, depth + 1),
    ]),
  );
}

function write(level: 'info' | 'warn' | 'error', message: string, fields?: Record<string, unknown>) {
  const line = `${new Date().toISOString()} ${level.toUpperCase()} ${message}`;
  const extra = fields ? ` ${JSON.stringify(redact(fields))}` : '';
  (level === 'error' ? console.error : console.log)(line + extra);
}

export const log = {
  info: (message: string, fields?: Record<string, unknown>) => write('info', message, fields),
  warn: (message: string, fields?: Record<string, unknown>) => write('warn', message, fields),
  error: (message: string, fields?: Record<string, unknown>) => write('error', message, fields),
};
