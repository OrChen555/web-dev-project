const express = require('express');

const asyncHandler = require('../middlewares/asyncHandler');
const load = require('../middlewares/load');
const { requireAdmin, protectAdminAccount } = require('../middlewares/auth');
const User = require('../models/user');
const { list, create, update, remove } = require('../controllers/users');

const router = express.Router();

// One line that covers everything below it. A route added here later is
// protected by where it sits, which is harder to forget than remembering to
// guard it.
router.use(requireAdmin);

router.get('/', asyncHandler(list));
router.post('/', asyncHandler(create));

// The two rules for acting on one account read off the route rather than
// hiding inside each handler: fetch it, refuse if it is the administrator,
// then run. Both handlers get the account already loaded on req.target.
router.patch('/:id', load(User), protectAdminAccount, asyncHandler(update));
router.delete('/:id', load(User), protectAdminAccount, asyncHandler(remove));

module.exports = router;
