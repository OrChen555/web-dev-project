const express = require('express');

const asyncHandler = require('../middlewares/asyncHandler');
const { signIn, signOut } = require('../controllers/session');

const router = express.Router();

// A session is a thing you create and delete, so it reads as one rather than as
// /login and /logout.
router.post('/', asyncHandler(signIn));
router.delete('/', asyncHandler(signOut));

module.exports = router;
