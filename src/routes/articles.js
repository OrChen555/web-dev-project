const express = require('express');

const asyncHandler = require('../middlewares/asyncHandler');
const load = require('../middlewares/load');
const { requireAuth, requireRole } = require('../middlewares/auth');
const Article = require('../models/article');
const { list, one, create, submit } = require('../controllers/articles');

const router = express.Router();

// Reading the published site needs no session: these are the public feed and
// the public article. Everything that writes belongs to the reporter and editor
// areas and goes through the state machine.
router.get('/', asyncHandler(list));
router.get('/:id', asyncHandler(one));

router.post('/',
  requireAuth,
  requireRole('reporter'),
  asyncHandler(create)
);

router.post('/:id/submit',
  requireAuth,
  requireRole('reporter'),
  load(Article),
  asyncHandler(submit)
);

module.exports = router;
