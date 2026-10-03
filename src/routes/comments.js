const express = require('express');

const load = require('../middlewares/load');
const { requireRole } = require('../middlewares/auth');
const Comment = require('../models/comment');
const { update, remove } = require('../controllers/comments');
const asyncHandler = require('../middlewares/asyncHandler');

const router = express.Router();

// A reader has no account, so there is nobody to hand a comment back to once it
// is posted. Changing or removing one is moderation, and that is the editor's.
router.patch('/:id',
  requireRole('editor'),
  load(Comment),
  asyncHandler(update)
);

router.delete('/:id',
  requireRole('editor'),
  load(Comment),
  asyncHandler(remove)
);

module.exports = router;
