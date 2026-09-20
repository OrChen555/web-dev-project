const { HttpError } = require('../errors');
const logger = require('../logger');
const User = require('../models/user');

// Fields are picked out one at a time rather than copied across from the body.
// Object.assign(user, req.body) is how somebody grants themselves isAdmin.
const readBody = (body) => ({
  username: String(body.username || '').trim().toLowerCase(),
  password: String(body.password || ''),
  name: String(body.name || '').trim(),
  role: String(body.role || '')
});

async function list(req, res) {
  const users = await User.find().sort({ isAdmin: -1, username: 1 });
  res.json(users);
}

async function create(req, res) {
  const { username, password, name, role } = readBody(req.body);

  if (!username || !password || !name) throw new HttpError(400, 'Username, password and name are all required');
  if (!User.ROLES.includes(role)) throw new HttpError(400, `Role must be one of: ${User.ROLES.join(', ')}`);

  // isAdmin is never read from a request. The one administrator is made at
  // startup from the environment and there is no other way in.
  const taken = await User.findOne({ username });
  if (taken) throw new HttpError(409, 'That username is taken');

  const user = await User.create({ username, password, name, role });
  logger.info('user created', { by: req.user.username, username, role });

  res.status(201).location(`/api/users/${user._id}`).json(user);
}

async function update(req, res) {
  const user = await User.findById(req.params.id);
  if (!user) throw new HttpError(404, 'No such user');

  // Demoting the only administrator would lock the system out of itself.
  if (user.isAdmin) throw new HttpError(403, 'The administrator account cannot be changed here');

  const { name, role, password } = readBody(req.body);

  if (name) user.name = name;
  if (password) user.password = password;
  if (req.body.role !== undefined) {
    if (!User.ROLES.includes(role)) throw new HttpError(400, `Role must be one of: ${User.ROLES.join(', ')}`);
    user.role = role;
  }

  await user.save();
  logger.info('user updated', { by: req.user.username, username: user.username });

  res.json(user);
}

async function remove(req, res) {
  const user = await User.findById(req.params.id);
  if (!user) throw new HttpError(404, 'No such user');
  if (user.isAdmin) throw new HttpError(403, 'The administrator account cannot be deleted');

  await user.deleteOne();
  logger.info('user deleted', { by: req.user.username, username: user.username });

  res.status(204).end();
}

function page(req, res) {
  res.render('admin/users', { title: 'ניהול משתמשים', script: '/js/admin-users.js', roles: User.ROLES });
}

module.exports = { list, create, update, remove, page };
