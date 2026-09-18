const db = require('../db');

// The status code matters as much as the body here: whatever watches this route
// should be able to tell that we are unwell without reading the JSON.
async function health(req, res) {
  const reachable = await db.ping();

  res.status(reachable ? 200 : 503).json({
    status: reachable ? 'ok' : 'degraded',
    database: db.state(),
    uptime: Math.round(process.uptime())
  });
}

module.exports = { health };
