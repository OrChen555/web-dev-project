const weather = require('../services/weather');

// The widget asks for one city at a time, and the answer is the same for every
// reader, which is why it is cached in the service and not per request here.
//
// An unknown city is thrown as a 400 like any other bad request. Having no
// weather at all is answered here instead: the service has logged that outage
// once already, and the error middleware would log it again, stack and all, for
// every page that loads until it is over. Same body shape either way.
async function current(req, res) {
  const reading = await weather.current(req.query.city);

  if (!reading) {
    res.set('Retry-After', String(weather.retryAfterSeconds()));
    return res.status(503).json({ error: 'The weather is not available right now' });
  }

  res.json(reading);
}

module.exports = { current };
