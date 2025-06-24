const express = require('express');
const jwt = require('jsonwebtoken');
const userQuotaService = require('../services/userQuotaService');
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

        // Get current user quota stats from persistent storage
        const userStats = await userQuotaService.getUserStats(req.user.id);

        // Generate JWT token for Azure Functions
        const uploadToken = jwt.sign({
            id: req.user.id,
            username: req.user.username,
            discordId: req.user.id,
            quota: userStats.quota,
            totalUploadSize: userStats.totalUploadSize,
            exp: Math.floor(Date.now() / 1000) + (60 * 60) // 1 hour expiry
        }, process.env.JWT_SECRET); // Use JWT secret that matches Azure Functions

        res.json({
            success: true,
            uploadToken,
            user: {
                id: req.user.id,
                username: req.user.username,
                quota: userStats.quota,
                totalUploadSize: userStats.totalUploadSize,
                remainingQuota: userStats.remainingQuota,
                uploadCount: userStats.uploadCount,
                usagePercentage: userStats.usagePercentage
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

/**
 * GET /api/user-quota-stats
 * Get current user's quota usage statistics
 */
router.get('/user-quota-stats', async (req, res) => {
    try {
        // Check if user is authenticated
        if (!req.user) {
            return res.status(401).json({
                success: false,
                error: 'User not authenticated'
            });
        }

        console.log('📊 Getting quota stats for user:', req.user.username);
        
        // Get real quota data by scanning Azure storage
        const userStats = await userQuotaService.getUserStats(req.user.id);
        
        console.log('📊 User quota stats:', {
            user: req.user.username,
            totalSize: (userStats.totalUploadSize / 1024 / 1024).toFixed(2) + ' MB',
            remaining: (userStats.remainingQuota / 1024 / 1024).toFixed(2) + ' MB',
            uploadCount: userStats.uploadCount,
            usagePercentage: userStats.usagePercentage + '%'
        });

        res.json({
            success: true,
            stats: {
                quota: userStats.quota,
                totalUploadSize: userStats.totalUploadSize,
                remainingQuota: userStats.remainingQuota,
                uploadCount: userStats.uploadCount,
                usagePercentage: userStats.usagePercentage,
                quotaFormatted: {
                    total: (userStats.quota / 1024 / 1024 / 1024).toFixed(1) + ' GB',
                    used: (userStats.totalUploadSize / 1024 / 1024).toFixed(1) + ' MB',
                    remaining: (userStats.remainingQuota / 1024 / 1024).toFixed(1) + ' MB'
                }
            }
        });

    } catch (error) {
        console.error('❌ Failed to get user quota stats:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get quota stats'
        });
    }
});

module.exports = router;
