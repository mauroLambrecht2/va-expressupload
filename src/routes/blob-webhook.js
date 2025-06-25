const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { videoStore } = require('../config/database');
const { sendDiscordWebhook } = require('../services/discordService');
const config = require('../config');
const router = express.Router();

// POST /api/blob-upload-complete
router.post('/blob-upload-complete', requireAuth, async (req, res) => {
  try {
    const { blobName, originalName, size } = req.body;
    if (!blobName || !originalName || !size) {
      return res.status(400).json({ error: 'Missing blobName, originalName, or size' });
    }
    // Store video metadata (simplified, you may want to add more fields)
    // Only use a UUID as the videoId and blobName (no original filename in the id)
    const uuid = blobName.split('-')[0]; // Assumes blobName is `${uuid}-${filename}`
    const videoId = uuid;
    const blobUrl = `https://${config.azure.accountName}.blob.core.windows.net/${config.azure.containerName}/${blobName}`;
    const videoData = {
      id: videoId,
      originalName,
      blobName,
      blobUrl,
      size,
      uploadedBy: req.user.id,
      uploaderUsername: req.user.username,
      uploadDate: new Date().toISOString(),
      // Add required fields for videoService and streaming
      containerName: config.azure.containerName,
      contentType: 'video/mp4', // or detect from file extension
      fileFormat: originalName.split('.').pop(),
      isMKV: originalName.split('.').pop() === 'mkv',
    };
    videoStore.set(videoId, videoData);
    // Send Discord webhook
    // Always use backendUrl for shareLink, never frontendUrl
    const shareLink = `${config.server.backendUrl}/v/${videoId}`;
    await sendDiscordWebhook(shareLink, videoData);
    res.json({ success: true, videoId, shareLink });
  } catch (error) {
    console.error('Failed to handle blob upload complete:', error);
    res.status(500).json({ error: 'Failed to handle blob upload complete' });
  }
});

module.exports = router;
