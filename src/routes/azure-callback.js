const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { videoStore, userStore } = require('../config/database');
const { recordUpload } = require('../middleware/auth');
const { sendDiscordWebhook } = require('../services/discordService');

// Store video metadata from Azure Functions after successful upload
router.post('/store-video-metadata', async (req, res) => {
    console.log('🔄 Received metadata storage request from Azure Functions');
    console.log('📋 Request body:', JSON.stringify(req.body, null, 2));
    console.log('📋 Headers:', JSON.stringify(req.headers, null, 2));
    
    try {
        // Validate authorization from Azure Functions
        const authHeader = req.headers.authorization;
        if (!authHeader) {
            console.log('❌ No authorization header found');
            return res.status(401).json({ error: 'No authorization header provided' });
        }

        const token = authHeader.replace('Bearer ', '');
        console.log('🔐 Verifying JWT token...');
        const user = jwt.verify(token, process.env.JWT_SECRET);
        console.log('✅ JWT verified for user:', user.username);

        const { videoId, blobName, blobUrl, size, originalName, uploadTime } = req.body;        if (!videoId || !blobName || !blobUrl || !size || !originalName) {
            console.log('❌ Missing required fields:', { videoId, blobName, blobUrl, size, originalName });
            return res.status(400).json({ error: 'Missing required video metadata' });
        }

        console.log('📁 Processing video metadata for:', originalName);

        // Check if it's an MKV file (for compatibility handling)
        const fileExtension = originalName.split('.').pop()?.toLowerCase() || 'mp4';
        const isMKV = fileExtension === 'mkv' || getContentType(originalName) === 'video/x-matroska';

        // Store video metadata for view page
        const videoData = {
            id: videoId,
            blobName,
            blobUrl,
            containerName: 'videos', // Azure Functions use 'videos' container
            originalName,
            size,
            contentType: getContentType(originalName),
            fileFormat: '.' + fileExtension,
            isMKV: isMKV,
            uploadDate: new Date().toISOString(),
            downloadCount: 0,
            ip: req.ip || 'unknown',
            uploadedBy: user.id,
            uploaderUsername: user.username,
            uploaderAvatar: user.avatar
        };        videoStore.set(videoId, videoData);
        console.log('💾 Video metadata stored successfully for:', videoId);

        // Generate URLs for consistent response
        const baseUrl = process.env.NODE_ENV === 'production' 
            ? 'https://va-expressupload.onrender.com'
            : 'http://localhost:8000';
        
        const shareLink = `${baseUrl}/v/${videoId}`;
        const downloadLink = `${baseUrl}/download/${videoId}`;

        // Record upload for user quota tracking
        const uploadRecord = {
            ...videoData,
            shareLink,
            downloadLink,
            previewUrl: blobUrl
        };
        recordUpload(user.id, uploadRecord);        // Send Discord webhook only for new videos (prevent duplicates)
        const isNewVideo = !videoStore.has(videoId + '_webhook_sent');
        if (isNewVideo) {
            console.log('📢 Attempting to send Discord webhook for new video...');
            try {
                await sendDiscordWebhook(shareLink, videoData);
                console.log('✅ Discord webhook sent successfully');
                // Mark webhook as sent to prevent duplicates
                videoStore.set(videoId + '_webhook_sent', true);
            } catch (webhookError) {
                console.error('❌ Discord webhook failed:', webhookError.message);
                console.error('❌ Webhook error stack:', webhookError.stack);
            }
        } else {
            console.log('ℹ️ Skipping webhook - already sent for this video');
        }

        res.json({
            success: true,
            videoId,
            shareLink,
            downloadUrl: downloadLink,
            message: 'Video metadata stored successfully'
        });

    } catch (error) {
        console.error('Store video metadata error:', error);
        
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({ error: 'Invalid token' });
        }
        
        res.status(500).json({ 
            error: 'Failed to store video metadata',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

function getContentType(filename) {
    const extension = filename.split('.').pop()?.toLowerCase() || 'mp4';
    const contentTypes = {
        'mp4': 'video/mp4',
        'avi': 'video/x-msvideo',
        'mov': 'video/quicktime',
        'wmv': 'video/x-ms-wmv',
        'flv': 'video/x-flv',
        'webm': 'video/webm',
        'mkv': 'video/x-matroska',
        'm4v': 'video/x-m4v'
    };
    return contentTypes[extension] || 'video/mp4';
}

module.exports = router;
