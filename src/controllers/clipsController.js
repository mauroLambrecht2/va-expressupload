const { videoStore, userStore } = require('../config/database');
const { getDiscordAvatarUrl } = require('../services/authService');
const { getBaseUrl } = require('../utils/helpers');

// Get all clips
const getAllClips = (req, res) => {
    try {
        const allClips = [];
        
        for (const [videoId, videoData] of videoStore.entries()) {
            const baseUrl = getBaseUrl(req);
            
            // Get uploader info from stored user data or video metadata
            const storedUser = userStore.get(videoData.uploadedBy);
            const uploader = {
                id: videoData.uploadedBy,
                username: storedUser?.username || videoData.uploaderUsername || 'Unknown User',
                avatar: getDiscordAvatarUrl(storedUser || {
                    id: videoData.uploadedBy,
                    username: videoData.uploaderUsername,
                    avatar: videoData.uploaderAvatar,
                    discriminator: '0'
                })
            };
            
            allClips.push({
                id: videoId,
                originalName: videoData.originalName,
                size: videoData.size,
                uploadDate: videoData.uploadDate,
                shareLink: `${baseUrl}/v/${videoId}`,
                username: uploader.username,
                userAvatar: uploader.avatar
            });
        }
        
        // Sort by upload date (newest first)
        allClips.sort((a, b) => new Date(b.uploadDate).getTime() - new Date(a.uploadDate).getTime());
        
        res.json({
            clips: allClips,
            total: allClips.length
        });
    } catch (error) {
        console.error('Error fetching clips:', error);
        res.status(500).json({ error: 'Failed to fetch clips' });
    }
};

// Get clips with detailed info
const getClipsDetailed = (req, res) => {
    try {
        const allClips = [];
        
        for (const [videoId, videoData] of videoStore.entries()) {
            const baseUrl = getBaseUrl(req);
            
            // Get uploader info from stored user data or video metadata
            const storedUser = userStore.get(videoData.uploadedBy);
            const uploaderUser = storedUser || {
                id: videoData.uploadedBy,
                username: videoData.uploaderUsername,
                avatar: videoData.uploaderAvatar,
                discriminator: '0'
            };
            
            const uploader = {
                id: videoData.uploadedBy,
                username: uploaderUser.username || 'Unknown User',
                avatar: getDiscordAvatarUrl(uploaderUser)
            };
            
            allClips.push({
                id: videoId,
                originalName: videoData.originalName,
                filename: videoData.originalName,
                size: videoData.size,
                uploadDate: videoData.uploadDate,
                shareLink: `${baseUrl}/v/${videoId}`,
                downloadUrl: `${baseUrl}/download/${videoId}`,
                uploadedBy: {
                    id: uploader.id,
                    username: uploader.username,
                    avatar: uploader.avatar
                }
            });
        }
        
        // Sort by upload date (newest first)
        allClips.sort((a, b) => new Date(b.uploadDate) - new Date(a.uploadDate));
        
        res.json({ clips: allClips });
    } catch (error) {
        console.error('Error fetching all clips:', error);
        res.status(500).json({ error: 'Failed to fetch clips' });
    }
};

module.exports = {
    getAllClips,
    getClipsDetailed
};
