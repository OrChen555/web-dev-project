const express = require('express');

const asyncHandler = require('../middlewares/asyncHandler');
const { current } = require('../controllers/weather');

const router = express.Router();

// Public, like the feed: the widget is on the home page, for guests too.
router.get('/', asyncHandler(current));

module.exports = router;
