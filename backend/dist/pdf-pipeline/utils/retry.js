import { createLogger } from './logger.js';
const log = createLogger('Retry');
export async function withRetry(fn, options = {}) {
    const maxAttempts = options.maxAttempts ?? 3;
    const baseDelayMs = options.baseDelayMs ?? 1000;
    const maxDelayMs = options.maxDelayMs ?? 15000;
    const label = options.label ?? 'operation';
    let lastError;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await fn();
        }
        catch (error) {
            lastError = error;
            if (attempt >= maxAttempts)
                break;
            const delay = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
            log.warn(`${label} failed (attempt ${attempt}/${maxAttempts}), retrying in ${delay}ms`, {
                error: error instanceof Error ? error.message : String(error),
            });
            await new Promise((resolve) => setTimeout(resolve, delay));
        }
    }
    throw lastError instanceof Error
        ? lastError
        : new Error(`${label} failed after ${maxAttempts} attempts`);
}
//# sourceMappingURL=retry.js.map