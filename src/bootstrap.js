const logger = require('./logger');
const config = require('./config');
const User = require('./models/user');

// There is no route that can create an administrator, so it is created here,
// from the environment, when the server starts. Starting again with the account
// already in place changes nothing.
async function ensureAdmin() {
  const existing = await User.findOne({ isAdmin: true });
  if (existing) return existing;

  const admin = await User.create({
    username: config.admin.username,
    password: config.admin.password,
    name: config.admin.username,
    role: 'editor',
    isAdmin: true
  });

  logger.info('administrator account created', { username: admin.username });
  return admin;
}

module.exports = { ensureAdmin };
