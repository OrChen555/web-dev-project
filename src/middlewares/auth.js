const { HttpError } = require('../errors');
const User = require('../models/user');

// The session holds an id and nothing else. Who that is, and what they may do,
// is read from the database on every request, so that an account deleted or
// demoted a minute ago stops being able to act on the next click. A role
// carried in the browser could only ever tell us what was true at sign-in.
async function loadUser(req, res, next) {
  if (!req.session || !req.session.userId) return next();

  const user = await User.findById(req.session.userId);

  // The account is gone. The cookie is meaningless now, so throw it away rather
  // than letting it be presented again.
  if (!user) {
    req.session.destroy(() => {});
    return next();
  }

  req.user = user;
  res.locals.user = user;
  next();
}

const requireAuth = (req, res, next) => {
  if (!req.user) return next(new HttpError(401, 'You are not signed in'));
  next();
};

// 401 says we do not know you. 403 says we do, and the answer is still no.
const requireRole = (role) => (req, res, next) => {
  if (!req.user) return next(new HttpError(401, 'You are not signed in'));
  if (req.user.role !== role) return next(new HttpError(403, `This is for the ${role} to do`));
  next();
};

const requireAdmin = (req, res, next) => {
  if (!req.user) return next(new HttpError(401, 'You are not signed in'));
  if (!req.user.isAdmin) return next(new HttpError(403, 'Only the administrator can do this'));
  next();
};

// Not parameterised, because there is only ever one rule here: the single
// administrator is created at startup and cannot be edited or removed through
// the API. It reads req.target, so it goes after load(User) in the chain.
const protectAdminAccount = (req, res, next) => {
  // No target means this was put before load(User) instead of after it. Carrying
  // on would leave the route unguarded and say nothing about it, so it fails as
  // the wiring mistake it is: a plain Error, logged with its stack, not a 4xx.
  if (!req.target) {
    return next(new Error('protectAdminAccount runs before load(User); check the route order'));
  }

  if (req.target.isAdmin) {
    return next(new HttpError(403, 'The administrator account cannot be changed through the API'));
  }

  next();
};

module.exports = { loadUser, requireAuth, requireRole, requireAdmin, protectAdminAccount };
