const express = require('express');
const router = express.Router();
const clipsController = require('../controllers/clipsController');
const { requireAuth } = require('../middleware/auth');

// Get all clips
router.get('/', requireAuth, clipsController.getAllClips);
router.get('/all', requireAuth, clipsController.getClipsDetailed);

module.exports = router;
