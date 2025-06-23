const { videoStore } = require('../config/database');
const { calculatePopularityScore } = require('../utils/helpers');

// Track video view
const trackView = (req, res) => {
    const { videoId } = req.params;
    const videoData = videoStore.get(videoId);
    
    if (!videoData) {
        return res.status(404).json({ error: 'Video not found' });
    }
    
    try {
        // Update view count and tracking
        videoData.views = (videoData.views || 0) + 1;
        videoData.lastViewed = new Date().toISOString();
        
        // Track unique viewers (basic implementation using IP)
        const viewerIP = req.ip;
        if (!videoData.viewerIPs) {
            videoData.viewerIPs = new Set();
        }
        videoData.viewerIPs.add(viewerIP);
        videoData.uniqueViewers = videoData.viewerIPs.size;

        // Update video store
        videoStore.set(videoId, videoData);

        res.json({ 
            success: true, 
            views: videoData.views,
            uniqueViewers: videoData.uniqueViewers
        });
    } catch (error) {
        console.error('Error tracking view:', error);
        res.status(500).json({ error: 'Failed to track view' });
    }
};

// Track video share
const trackShare = (req, res) => {
    const { videoId } = req.params;
    const videoData = videoStore.get(videoId);

    if (!videoData) {
        return res.status(404).json({ error: 'Video not found' });
    }

    try {
        // Update share count
        videoData.shareCount = (videoData.shareCount || 0) + 1;
        videoData.lastShared = new Date().toISOString();

        // Update video store
        videoStore.set(videoId, videoData);

        res.json({ 
            success: true, 
            shares: videoData.shareCount
        });
    } catch (error) {
        console.error('Error tracking share:', error);
        res.status(500).json({ error: 'Failed to track share' });
    }
};

// Get video analytics
const getVideoAnalytics = (req, res) => {
    const { videoId } = req.params;
    const videoData = videoStore.get(videoId);

    if (!videoData) {
        return res.status(404).json({ error: 'Video not found' });
    }

    // Check if user owns the video or has permission to view analytics
    const isOwner = videoData.uploadedBy === req.user.id;
    if (!isOwner) {
        return res.status(403).json({ error: 'Not authorized to view analytics for this video' });
    }

    try {
        // Calculate additional stats
        const uploadDate = new Date(videoData.uploadDate);
        const daysSinceUpload = Math.floor((Date.now() - uploadDate.getTime()) / (1000 * 60 * 60 * 24));
        const avgViewsPerDay = daysSinceUpload > 0 ? (videoData.views || 0) / daysSinceUpload : 0;

        const analytics = {
            videoId: videoId,
            originalName: videoData.originalName,
            views: videoData.views || 0,
            downloads: videoData.downloadCount || 0,
            shares: videoData.shareCount || 0,
            uploadDate: videoData.uploadDate,
            size: videoData.size,
            fileType: videoData.fileFormat || require('path').extname(videoData.originalName),
            daysSinceUpload,
            avgViewsPerDay: Math.round(avgViewsPerDay * 100) / 100,
            contentType: videoData.contentType,
            uniqueViewers: videoData.uniqueViewers || 0,
            lastViewed: videoData.lastViewed || null,
            popularityScore: calculatePopularityScore(videoData)
        };

        res.json(analytics);
    } catch (error) {
        console.error('Error fetching video analytics:', error);
        res.status(500).json({ error: 'Failed to fetch video analytics' });
    }
};

// Get global analytics overview
const getAnalyticsOverview = (req, res) => {
    const stats = {
        totalVideos: videoStore.size,
        totalViews: 0,
        totalDownloads: 0,
        totalSize: 0,
        popularVideos: [],
        recentUploads: []
    };
    
    const videos = Array.from(videoStore.values());
    
    videos.forEach(video => {
        stats.totalViews += video.views || 0;
        stats.totalDownloads += video.downloadCount || 0;
        stats.totalSize += video.size || 0;
    });
    
    // Top 5 most viewed videos
    stats.popularVideos = videos
        .sort((a, b) => (b.views || 0) - (a.views || 0))
        .slice(0, 5)
        .map(v => ({
            id: v.id,
            name: v.originalName,
            views: v.views || 0,
            uploader: v.uploaderUsername
        }));
    
    // Recent uploads
    stats.recentUploads = videos
        .sort((a, b) => new Date(b.uploadDate).getTime() - new Date(a.uploadDate).getTime())
        .slice(0, 10)
        .map(v => ({
            id: v.id,
            name: v.originalName,
            uploadDate: v.uploadDate,
            uploader: v.uploaderUsername,
            size: v.size
        }));
    
    res.json(stats);
};

module.exports = {
    trackView,
    trackShare,
    getVideoAnalytics,
    getAnalyticsOverview
};
