// Structured JSON Logger
const logger = {
    info: (msg, meta = {}) => {
        console.log(JSON.stringify({ level: 'info', timestamp: new Date(), message: msg, ...meta }));
    },
    error: (msg, error) => {
        console.error(JSON.stringify({ level: 'error', timestamp: new Date(), message: msg, error: error?.message, stack: error?.stack }));
    },
    warn: (msg, meta = {}) => {
        console.warn(JSON.stringify({ level: 'warn', timestamp: new Date(), message: msg, ...meta }));
    }
};

module.exports = logger;
