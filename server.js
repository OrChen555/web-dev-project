const config = require('./src/config');
const logger = require('./src/logger');
const db = require('./src/db');
const app = require('./src/app');

// Nothing is served until the database answers, so that a request never arrives
// at a route with nothing behind it.
async function start() {
  await db.connect(config.mongoUri);
  app.listen(config.port, () => logger.info(`the presses are running on http://localhost:${config.port}`));
}

start().catch((err) => {
  logger.error('the server could not start', { detail: err.message });
  process.exit(1);
});

// Either of these means a fault we did not account for. Recording it and
// stopping is better than carrying on in a state we cannot describe.
process.on('unhandledRejection', (err) => {
  logger.error('unhandled rejection', { detail: String(err && err.message) });
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  logger.error('uncaught exception', { detail: err.message, stack: err.stack });
  process.exit(1);
});
