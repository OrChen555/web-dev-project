const crypto = require('crypto');

const config = require('../config');

const COOKIE = 'visitor';
const YEAR = 365 * 24 * 60 * 60 * 1000;

const OPTIONS = {
  httpOnly: true,
  sameSite: 'lax',
  secure: config.isProduction,
  signed: true,
  maxAge: YEAR
};

// One anonymous id per browser. Three separate requirements need to tell one
// device from another without an account behind it: the seen and not seen
// filter on the feed, counting views, and the three comments a minute limit.
// They share this rather than each inventing their own.
//
// Signed, because httpOnly only keeps the page's own scripts out. It does not
// stop anybody sending a Cookie header of their choosing, and this one id is
// what dedupes view counts and holds the comment limit. Signing does not stop
// someone throwing the cookie away to be counted twice, but it does stop them
// naming an id that is not theirs and interfering with another reader's feed.
function visitor(req, res, next) {
  // A value whose signature does not check out never appears here, so a tampered
  // cookie reads as no cookie at all and is replaced.
  let id = req.signedCookies && req.signedCookies[COOKIE];

  if (!id) {
    id = crypto.randomUUID();
    res.cookie(COOKIE, id, OPTIONS);
  }

  req.visitorId = id;
  next();
}

module.exports = visitor;
