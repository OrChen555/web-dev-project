const express = require('express');

const asyncHandler = require('../middlewares/asyncHandler');
const { health } = require('../controllers/health');

const router = express.Router();

router.get('/', asyncHandler(health));

module.exports = router;
