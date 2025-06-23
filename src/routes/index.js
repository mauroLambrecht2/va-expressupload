const express = require('express');
const router = express.Router();

// Import all route modules
const authRoutes = require('./auth');
const videoRoutes = require('./video');
const clipsRoutes = require('./clips');
const analyticsRoutes = require('./analytics');
const { router: uploadProgressRoutes } = require('./upload-progress');

// Mount routes
router.use('/auth', authRoutes);
router.use('/', videoRoutes); // Video routes at root level for upload
router.use('/api/clips', clipsRoutes);
router.use('/api/analytics', analyticsRoutes);
router.use('/api/upload', uploadProgressRoutes);

module.exports = router;
