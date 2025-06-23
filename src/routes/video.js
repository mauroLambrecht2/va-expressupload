const express = require('express');
const router = express.Router();
const videoController = require('../controllers/videoController');
const { requireAuth, requireGuildMembership, checkUploadQuota } = require('../middleware/auth');
const { uploadLimit } = require('../middleware/rateLimiter');
const upload = require('../middleware/upload');

// Upload video with enhanced error handling
router.post('/upload', 
    uploadLimit, 
    requireAuth, 
    requireGuildMembership,
    checkUploadQuota, 
    upload.single('video'),
    upload.handleUploadError, // Add upload error handling
    videoController.uploadVideo
);

// View/embed route for clips
router.get('/v/:videoId', videoController.viewVideo);
router.get('/download/:videoId', videoController.downloadVideo);

// Video streaming routes
router.options('/stream/:videoId', videoController.handleCorsOptions);
router.head('/stream/:videoId', videoController.getVideoHead);
router.get('/stream/:videoId', videoController.streamVideo);

module.exports = router;
