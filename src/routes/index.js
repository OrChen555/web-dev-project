const express = require('express');

const health = require('./health');
const session = require('./session');
const users = require('./users');
const { home } = require('../controllers/home');
const { loginPage } = require('../controllers/session');
const { requireAdmin } = require('../middlewares/auth');
const { page: usersPage } = require('../controllers/users');
const { styleguide } = require('../controllers/styleguide');

const router = express.Router();

// Two families of route, and one rule between them: anything under /api answers
// with JSON, everything else renders a page. The error middleware decides how to
// reply by reading the same rule off the URL, so new routes have to keep to it.
router.use('/api/health', health);
router.use('/api/session', session);
router.use('/api/users', users);

router.get('/', home);
router.get('/login', loginPage);
router.get('/admin/users', requireAdmin, usersPage);
router.get('/styleguide', styleguide);

module.exports = router;
