const express = require('express');

const asyncHandler = require('../middlewares/asyncHandler');
const { list, one, view } = require('../controllers/articles');

const router = express.Router();

// Reading the published site needs no session: these are the public feed and
// the public article. Everything that writes belongs to the reporter and editor
// areas and goes through the state machine.
router.get('/', asyncHandler(list));
router.get('/:id', asyncHandler(one));

// A guest's view counts as much as anyone's, so this needs no session either.
// The device comes from the visitor cookie, never from the body.
router.post('/:id/views', asyncHandler(view));

module.exports = router;
