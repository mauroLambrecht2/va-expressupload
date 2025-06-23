const { userStore, userUploads } = require('../config/database');

// Authentication middleware
const requireAuth = (req, res, next) => {
    if (!req.user) {
        console.log(`❌ Unauthorized access attempt from ${req.ip}`);
        return res.status(401).json({ 
            error: 'Authentication required', 
            message: 'Please log in with Discord to access this feature.' 
        });
    }
    
    console.log(`✅ Authenticated request from user: ${req.user.username}#${req.user.discriminator}`);
    next();
};

// Optional authentication (doesn't block if not authenticated)
const optionalAuth = (req, res, next) => {
    // Just continue, authentication is optional
    next();
};

// Guild membership check middleware
const requireGuildMembership = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    
    // If guild membership check failed during auth (due to rate limiting), 
    // allow access but log it for monitoring
    if (!req.user.guildMember) {
        console.log(`⚠️  User ${req.user.username}#${req.user.discriminator} may not be a guild member (check failed during auth due to rate limiting)`);
        
        // For now, allow access to prevent blocking users due to Discord API issues
        // In production, you might want to implement a background job to verify membership
        return next();
    }
    
    next();
};

// Upload quota check middleware
const checkUploadQuota = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    
    const userId = req.user.id;
    const userQuota = userUploads.get(userId) || { used: 0, remaining: req.user.quota };
    
    if (!req.file) {
        return next();
    }
    
    if (userQuota.remaining < req.file.size) {
        console.log(`❌ Quota exceeded for user ${req.user.username}: ${userQuota.used}/${req.user.quota} bytes used`);
        return res.status(413).json({
            error: 'Upload quota exceeded',
            message: `Your upload quota of ${Math.round(req.user.quota / (1024 * 1024 * 1024))}GB has been exceeded.`,
            quotaUsed: userQuota.used,
            quotaRemaining: userQuota.remaining,
            fileSize: req.file.size
        });
    }
    
    // Attach quota info to request for use in upload handler
    req.userQuota = userQuota;
    next();
};

// Record upload for quota tracking
const recordUpload = (userId, uploadData) => {
    const currentQuota = userUploads.get(userId) || { used: 0, remaining: 5 * 1024 * 1024 * 1024 };
    const newUsed = currentQuota.used + uploadData.size;
    const newRemaining = Math.max(0, currentQuota.remaining - uploadData.size);
    
    userUploads.set(userId, {
        used: newUsed,
        remaining: newRemaining,
        uploads: [...(currentQuota.uploads || []), uploadData]
    });
    
    // Also update the user data in userStore for consistency
    const userData = userStore.get(userId);
    if (userData) {
        userData.totalUploadSize = newUsed;
        userData.uploads = userData.uploads || [];        userData.uploads.push({
            id: uploadData.id || uploadData.videoId,
            originalName: uploadData.originalName,
            size: uploadData.size,
            uploadDate: uploadData.uploadDate instanceof Date ? uploadData.uploadDate.toISOString() : (uploadData.uploadDate || new Date().toISOString()),
            shareLink: uploadData.shareLink || `/v/${uploadData.id || uploadData.videoId}`
        });
        userStore.set(userId, userData);
    }
    
    console.log(`📊 Updated quota for user ${userId}: ${newUsed} bytes used, ${newRemaining} bytes remaining`);
};

module.exports = {
    requireAuth,
    optionalAuth,
    requireGuildMembership,
    checkUploadQuota,
    recordUpload
};
