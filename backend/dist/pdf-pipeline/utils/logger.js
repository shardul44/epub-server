const LEVEL_ORDER = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
};
const configuredLevel = process.env.PDF_PIPELINE_LOG_LEVEL || 'info';
function shouldLog(level) {
    return LEVEL_ORDER[level] >= LEVEL_ORDER[configuredLevel];
}
function formatMessage(scope, message, meta) {
    const base = `[PdfPipeline:${scope}] ${message}`;
    if (meta === undefined)
        return base;
    try {
        return `${base} ${typeof meta === 'string' ? meta : JSON.stringify(meta)}`;
    }
    catch {
        return base;
    }
}
export function createLogger(scope) {
    return {
        debug(message, meta) {
            if (shouldLog('debug'))
                console.debug(formatMessage(scope, message, meta));
        },
        info(message, meta) {
            if (shouldLog('info'))
                console.log(formatMessage(scope, message, meta));
        },
        warn(message, meta) {
            if (shouldLog('warn'))
                console.warn(formatMessage(scope, message, meta));
        },
        error(message, meta) {
            if (shouldLog('error'))
                console.error(formatMessage(scope, message, meta));
        },
    };
}
//# sourceMappingURL=logger.js.map