const express = require('express');
const jwt = require('jsonwebtoken');
const router = express.Router();

/**
 * GET /api/get-azure-upload-token
 * Validates user session and issues Azure upload token
 */
router.post('/get-azure-upload-token', async (req, res) => {
    try {
        // Check if user is authenticated (existing session)
        if (!req.user) {
            return res.status(401).json({
                success: false,
                error: 'User not authenticated'
            });
        }

        // Generate JWT token for Azure Functions
        const uploadToken = jwt.sign({
            id: req.user.id,
            username: req.user.username,
            discordId: req.user.id,
            quota: req.user.quota || 5 * 1024 * 1024 * 1024, // 5GB default
            totalUploadSize: req.user.totalUploadSize || 0,
            exp: Math.floor(Date.now() / 1000) + (60 * 60) // 1 hour expiry
        }, process.env.SESSION_SECRET); // Use existing session secret

        res.json({
            success: true,
            uploadToken,
            user: {
                id: req.user.id,
                username: req.user.username,
                quota: req.user.quota || 5 * 1024 * 1024 * 1024,
                totalUploadSize: req.user.totalUploadSize || 0,
                remainingQuota: (req.user.quota || 5 * 1024 * 1024 * 1024) - (req.user.totalUploadSize || 0)
            }
        });

    } catch (error) {
        console.error('❌ Failed to generate Azure upload token:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to generate upload token'
        });
    }
});

module.exports = router;
