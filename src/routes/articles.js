const express = require('express');

const asyncHandler = require('../middlewares/asyncHandler');
const { list, one } = require('../controllers/articles');

const router = express.Router();

// Reading the published site needs no session: these are the public feed and
// the public article. Everything that writes belongs to the reporter and editor
// areas and goes through the state machine.
router.get('/', asyncHandler(list));
router.get('/:id', asyncHandler(one));

module.exports = router;
