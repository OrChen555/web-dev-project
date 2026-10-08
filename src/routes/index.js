const express = require('express');

const health = require('./health');
const session = require('./session');
const users = require('./users');
const articles = require('./articles');
const { home } = require('../controllers/home');
const { loginPage } = require('../controllers/session');
const { requireAuth, requireRole, requireAdmin } = require('../middlewares/auth');
const { page: usersPage } = require('../controllers/users');
const { list: reporterList, editor: reporterEditor } = require('../controllers/reporter');
const { queuePage, reviewPage, analyticsPage } = require('../controllers/editor');
const asyncHandler = require('../middlewares/asyncHandler');
const { styleguide } = require('../controllers/styleguide');

const router = express.Router();

// Two families of route, and one rule between them: anything under /api answers
// with JSON, everything else renders a page. The error middleware decides how to
// reply by reading the same rule off the URL, so new routes have to keep to it.
router.use('/api/health', health);
router.use('/api/session', session);
router.use('/api/users', users);
router.use('/api/articles', articles);

router.get('/', home);
router.get('/login', loginPage);
router.get('/admin/users', requireAdmin, usersPage);
router.get('/reporter/articles', requireRole('reporter'), reporterList);
router.get('/reporter/articles/:id', requireRole('reporter'), reporterEditor);
router.get('/editor/articles', requireRole('editor'), queuePage);
router.get('/editor/articles/:id', requireRole('editor'), asyncHandler(reviewPage));
router.get('/editor/analytics', requireRole('editor'), analyticsPage);
router.get('/styleguide', requireAuth, styleguide);

module.exports = router;
