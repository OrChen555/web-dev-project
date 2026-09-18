const express = require('express');

const health = require('./health');
const { home } = require('../controllers/home');

const router = express.Router();

// Two families of route, and one rule between them: anything under /api answers
// with JSON, everything else renders a page. The error middleware decides how to
// reply by reading the same rule off the URL, so new routes have to keep to it.
router.use('/api/health', health);

router.get('/', home);

module.exports = router;
