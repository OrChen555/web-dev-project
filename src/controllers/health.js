const db = require('../db');

// The status code matters as much as the body here: whatever watches this route
// should be able to tell that we are unwell without reading the JSON.
async function health(req, res) {
  // Checking the connection state first means a dead database answers at once.
  // ping() on its own waits out the driver's five second selection timeout,
  // which is the slowest possible reply to whoever is asking if we are up.
  const reachable = db.state() === 'connected' && await db.ping();

  res.status(reachable ? 200 : 503).json({
    status: reachable ? 'ok' : 'degraded',
    database: db.state(),
    uptime: Math.round(process.uptime())
  });
}

module.exports = { health };
