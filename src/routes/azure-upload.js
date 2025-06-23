const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { videoStore, userStore } = require('../config/database');
const jwt = require('jsonwebtoken');

const router = express.Router();

// Azure Function upload completion notification
router.post('/upload-complete', async (req, res) => {
    try {
        // Verify the request is from Azure Function
        const authHeader = req.headers.authorization;
        if (!authHeader) {
            return res.status(401).json({ error: 'No authorization header' });
        }

        const token = authHeader.replace('Bearer ', '');
        const decoded = jwt.verify(token, process.env.SESSION_SECRET);
        
        const { userId, uploadData } = req.body;
        
        if (decoded.id !== userId) {
            return res.status(403).json({ error: 'User ID mismatch' });
        }

        // Store video metadata in database
        videoStore.set(uploadData.videoId, {
            id: uploadData.videoId,
            originalName: uploadData.originalName,
            blobName: uploadData.blobName,
            size: uploadData.size,
            uploadDate: new Date(),
            downloadCount: 0,
            uploadedBy: userId,
            uploaderUsername: decoded.username || 'Unknown',
            uploaderAvatar: '',
            shareLink: uploadData.shareLink,
            downloadUrl: uploadData.downloadUrl
        });

        // Update user quota
        const userData = userStore.get(userId);
        if (userData) {
            userData.totalUploadSize = (userData.totalUploadSize || 0) + uploadData.size;
            userData.uploads = userData.uploads || [];
            userData.uploads.push({
                id: uploadData.videoId,
                originalName: uploadData.originalName,
                size: uploadData.size,
                uploadDate: new Date().toISOString(),
                shareLink: uploadData.shareLink
            });
            userStore.set(userId, userData);
        }

        console.log(`✅ Azure Function upload completed: ${uploadData.originalName} by user ${userId}`);
        
        res.json({ 
            success: true, 
            message: 'Upload metadata saved successfully' 
        });

    } catch (error) {
        console.error('❌ Azure Function upload completion failed:', error);
        res.status(500).json({ error: 'Failed to process upload completion' });
    }
});

module.exports = router;
