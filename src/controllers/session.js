const { HttpError } = require('../errors');
const { COOKIE_NAME, COOKIE_OPTIONS } = require('../session');
const logger = require('../logger');
const User = require('../models/user');

// Where each kind of person lands once they are in.
const landingFor = (user) => (user.isAdmin ? '/admin/users' : '/');

async function signIn(req, res) {
  // Forced to strings before they go anywhere near a query. A JSON body can
  // carry an object, and a username of { "$ne": null } would otherwise be read
  // by mongo as a filter and match the first account in the collection.
  const username = String(req.body.username || '').trim().toLowerCase();
  const password = String(req.body.password || '');

  const user = await User.findOne({ username }).select('+passwordHash');
  const ok = Boolean(user) && await user.checkPassword(password);

  // One message for both failures on purpose. Saying "no such user" would let
  // anybody work out which accounts exist.
  if (!ok) {
    logger.warn('sign in refused', { username });
    throw new HttpError(401, 'Wrong username or password');
  }

  // A new session id at the moment the session gains its privileges, so that an
  // id planted in the browser beforehand cannot be ridden afterwards.
  await new Promise((resolve, reject) => {
    req.session.regenerate((err) => (err ? reject(err) : resolve()));
  });

  req.session.userId = user._id;
  logger.info('signed in', { username: user.username, role: user.role });

  res.json({ id: user._id, name: user.name, role: user.role, isAdmin: user.isAdmin, redirect: landingFor(user) });
}

async function signOut(req, res) {
  const who = req.user ? req.user.username : null;

  await new Promise((resolve) => req.session.destroy(() => resolve()));
  // Name and attributes both come from session.js. A clearCookie whose path or
  // sameSite differs from the original sets a second cookie instead of removing
  // the first, and the session id stays in the browser.
  res.clearCookie(COOKIE_NAME, COOKIE_OPTIONS);

  if (who) logger.info('signed out', { username: who });
  res.status(204).end();
}

function loginPage(req, res) {
  if (req.user) return res.redirect(landingFor(req.user));
  res.render('login', { title: 'כניסה', script: '/js/login.js' });
}

module.exports = { signIn, signOut, loginPage };
