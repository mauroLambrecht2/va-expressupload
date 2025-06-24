const express = require('express');
const router = express.Router();

// Import all route modules
const authRoutes = require('./auth');
const videoRoutes = require('./video');
const clipsRoutes = require('./clips');
const analyticsRoutes = require('./analytics');
const { router: uploadProgressRoutes } = require('./upload-progress');
const azureTokenRoutes = require('./azure-token');
const azureCallbackRoutes = require('./azure-callback');
const blobSasRoutes = require('./blob-sas');
const blobWebhookRoutes = require('./blob-webhook');

// Mount routes
router.use('/auth', authRoutes);
router.use('/', videoRoutes); // Video routes at root level for upload
router.use('/api/clips', clipsRoutes);
router.use('/api/analytics', analyticsRoutes);
router.use('/api/upload', uploadProgressRoutes);
router.use('/api', azureTokenRoutes); // Azure token endpoint
router.use('/api', azureCallbackRoutes); // Azure callback endpoint
router.use('/api', blobSasRoutes); // Blob SAS URL endpoint for direct-to-blob uploads
router.use('/api', blobWebhookRoutes); // Blob upload complete endpoint for metadata and Discord webhook

module.exports = router;
