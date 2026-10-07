const express = require('express');

const asyncHandler = require('../middlewares/asyncHandler');
const load = require('../middlewares/load');
const { requireAuth, requireRole } = require('../middlewares/auth');
const Article = require('../models/article');
const { list, one, view, create, update, revise, submit } = require('../controllers/articles');

const router = express.Router();

// Reading the published site needs no session: these are the public feed and
// the public article. Everything that writes belongs to the reporter and editor
// areas and goes through the state machine.
router.get('/', asyncHandler(list));
router.get('/:id', asyncHandler(one));

// A guest's view counts as much as anyone's, so this needs no session either.
// The device comes from the visitor cookie, never from the body.
router.post('/:id/views', asyncHandler(view));

router.post('/',
  requireAuth,
  requireRole('reporter'),
  asyncHandler(create)
);

router.patch('/:id',
  requireAuth,
  load(Article),
  asyncHandler(update)
);

router.post('/:id/revise',
  requireAuth,
  load(Article),
  asyncHandler(revise)
);

router.post('/:id/submit',
  requireAuth,
  requireRole('reporter'),
  load(Article),
  asyncHandler(submit)
);

module.exports = router;
