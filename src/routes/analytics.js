const express = require('express');
const router = express.Router();
const analyticsController = require('../controllers/analyticsController');
const { requireAuth } = require('../middleware/auth');

// Analytics routes
router.post('/view/:videoId', analyticsController.trackView);
router.post('/share/:videoId', analyticsController.trackShare);
router.get('/video/:videoId', requireAuth, analyticsController.getVideoAnalytics);
router.get('/overview', requireAuth, analyticsController.getAnalyticsOverview);

module.exports = router;
