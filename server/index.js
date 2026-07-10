const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { loadConfig } = require('./config');
const { createRuntime } = require('./app');

const config = loadConfig();
const runtime = createRuntime({ config });

runtime.server.listen(config.port, () => {
  console.log(JSON.stringify({ level: 'info', message: 'server_started', port: config.port, environment: config.nodeEnv }));
});

async function shutdown(signal) {
  console.log(JSON.stringify({ level: 'info', message: 'server_stopping', signal }));
  await runtime.close();
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
