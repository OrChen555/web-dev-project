const crypto = require('crypto');

const COOKIE = 'visitor';
const YEAR = 365 * 24 * 60 * 60 * 1000;

// One anonymous id per browser. Three separate requirements need to tell one
// device from another without an account behind it: the seen and not seen
// filter on the feed, counting views, and the three comments a minute limit.
// They share this rather than each inventing their own.
function visitor(req, res, next) {
  let id = req.cookies && req.cookies[COOKIE];

  if (!id) {
    id = crypto.randomUUID();
    res.cookie(COOKIE, id, { httpOnly: true, sameSite: 'lax', maxAge: YEAR });
  }

  req.visitorId = id;
  next();
}

module.exports = visitor;
