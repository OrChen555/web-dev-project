const express = require('express');

const asyncHandler = require('../middlewares/asyncHandler');
const { requireAdmin } = require('../middlewares/auth');
const { list, create, update, remove } = require('../controllers/users');

const router = express.Router();

// Two lines that cover everything below them. A route added later is protected
// by where it sits, which is harder to forget than remembering to guard it.
router.use(requireAdmin);

router.get('/', asyncHandler(list));
router.post('/', asyncHandler(create));
router.patch('/:id', asyncHandler(update));
router.delete('/:id', asyncHandler(remove));

module.exports = router;
