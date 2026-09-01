type LogContext = Record<string, unknown>;

export const logger = {
  info(message: string, context?: LogContext): void {
    console.info(`[INFO] ${message}`, context ?? {});
  },

  warn(message: string, context?: LogContext): void {
    console.warn(`[WARN] ${message}`, context ?? {});
  },

  error(message: string, context?: LogContext): void {
    console.error(`[ERROR] ${message}`, context ?? {});
  },
};
