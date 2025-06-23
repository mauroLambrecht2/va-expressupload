// Helper function to format file sizes
const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

// Helper function to calculate popularity score
const calculatePopularityScore = (videoData) => {
    const views = videoData.views || 0;
    const downloads = videoData.downloadCount || 0;
    const shares = videoData.shareCount || 0;
    const uploadDate = new Date(videoData.uploadDate);
    const daysSinceUpload = Math.max(1, Math.floor((Date.now() - uploadDate.getTime()) / (1000 * 60 * 60 * 24)));
    
    // Calculate weighted score (views = 1 point, downloads = 2 points, shares = 3 points)
    const rawScore = views + (downloads * 2) + (shares * 3);
    
    // Normalize by time to account for newer vs older videos
    const timeAdjustedScore = rawScore / Math.log(daysSinceUpload + 1);
    
    return Math.round(timeAdjustedScore * 100) / 100;
};

// Generate base URL for the application
const getBaseUrl = (req) => {
    const nodeEnv = process.env.NODE_ENV;
    const backendUrl = process.env.BACKEND_URL;
    
    return nodeEnv === 'production' 
        ? backendUrl || `${req.protocol}://${req.get('host')}`
        : `${req.protocol}://${req.get('host')}`;
};

module.exports = {
    formatFileSize,
    calculatePopularityScore,
    getBaseUrl
};
