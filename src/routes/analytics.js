const express = require('express');

const asyncHandler = require('../middlewares/asyncHandler');
const { requireRole } = require('../middlewares/auth');
const editor = require('../controllers/editor');

// Mounted at /api/analytics in routes/index.js.
const router = express.Router();

// The analytics dashboard: views across the whole site. One article's chart
// stays at GET /api/articles/:id/views, next to the article it belongs to.
router.get('/overview', requireRole('editor'), asyncHandler(editor.overview));

module.exports = router;
