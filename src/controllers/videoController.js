const { uploadVideoToAzure, generateStreamUrl, getVideoProperties } = require('../services/videoService');
const { sendDiscordWebhook } = require('../services/discordService');
const { recordUpload } = require('../middleware/auth');
const { getBaseUrl } = require('../utils/helpers');
const { videoStore } = require('../config/database');
const { broadcastProgress, completeUpload } = require('../routes/upload-progress');
const crypto = require('crypto');

// Upload video with real-time progress
const uploadVideo = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No video file provided' });
        }

        // Generate upload ID for progress tracking
        const uploadId = crypto.randomBytes(16).toString('hex');
        
        // Send initial response with upload ID
        res.json({
            success: true,
            uploadId,
            message: 'Upload started',
            progressUrl: `/api/upload/progress/${uploadId}`
        });

        // Start the upload process asynchronously
        uploadVideoAsync(req.file, req.user, req.ip, uploadId);
        
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ 
            error: 'Upload failed. Please try again.', 
            details: process.env.NODE_ENV === 'development' ? error.message : undefined 
        });
    }
};

// Async upload function with progress tracking
const uploadVideoAsync = async (file, user, ip, uploadId) => {
    try {
        // Progress callback function
        const progressCallback = (progressData) => {
            broadcastProgress(uploadId, progressData);
        };

        // Start upload with progress tracking
        broadcastProgress(uploadId, {
            type: 'start',
            uploadId,
            filename: file.originalname,
            size: file.size
        });

        const result = await uploadVideoToAzure(file, user, ip, progressCallback);
        const { videoId, videoData, warning } = result;
        
        const baseUrl = process.env.NODE_ENV === 'production' 
            ? 'https://va-expressupload.onrender.com'
            : 'http://localhost:8000';
            
        const shareLink = `${baseUrl}/v/${videoId}`;
        const downloadLink = `${baseUrl}/download/${videoId}`;
        const previewUrl = videoData.blobUrl;

        // Send Discord webhook (if configured)
        try {
            await sendDiscordWebhook(shareLink, videoData);
        } catch (webhookError) {
            console.error('Discord webhook failed:', webhookError.message);
        }

        // Record upload for user quota tracking
        const uploadRecord = {
            ...videoData,
            shareLink,
            downloadLink,
            previewUrl
        };
        recordUpload(user.id, uploadRecord);
        
        // Complete the upload and notify clients
        completeUpload(uploadId, {
            id: videoId,
            shareLink,
            downloadUrl: downloadLink,
            previewUrl,
            filename: videoData.originalName,
            size: videoData.size,
            contentType: videoData.contentType,
            fileFormat: videoData.fileFormat,
            warning,
            user: {
                username: user.username,
                quotaUsed: user.quotaUsed + file.size,
                quotaRemaining: user.quotaRemaining - file.size
            }
        });
        
    } catch (error) {
        console.error('Async upload error:', error);
        
        // Handle specific errors
        let errorMessage = 'Upload failed. Please try again.';
        if (error.message && error.message.includes('File size too large')) {
            errorMessage = 'File too large. Maximum size is 1GB.';
        } else if (error.message && error.message.includes('Invalid video file')) {
            errorMessage = 'Invalid video file format.';
        } else if (error.message && error.message.includes('Azure upload failed')) {
            errorMessage = 'File upload failed. Please try again.';
        }
        
        // Broadcast error to clients
        broadcastProgress(uploadId, {
            type: 'error',
            uploadId,
            error: errorMessage,
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};
                
// Stream video (redirect to SAS URL)
const streamVideo = async (req, res) => {
    const { videoId } = req.params;
    
    try {
        const sasUrl = await generateStreamUrl(videoId);
        res.redirect(302, sasUrl);
    } catch (error) {
        console.error('❌ Video streaming error:', error);
        
        if (error.message.includes('Video not found')) {
            return res.status(404).json({ error: 'Video not found' });
        }
        
        res.status(500).json({ 
            error: 'Video streaming failed',
            details: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
};

// Get video properties for HEAD requests
const getVideoHead = async (req, res) => {
    const { videoId } = req.params;
    const videoData = videoStore.get(videoId);

    if (!videoData) {
        return res.status(404).end();
    }

    try {
        const properties = await getVideoProperties(videoId);
        
        // Set all required headers for video streaming
        res.setHeader('Content-Type', properties.contentType);
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Content-Length', properties.contentLength);
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Range, Accept-Encoding, Accept-Ranges, Content-Type');
        res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges, Content-Length, Content-Type');
        res.setHeader('Cache-Control', 'public, max-age=3600');
        
        res.status(200).end();
    } catch (error) {
        console.error('❌ Video HEAD error:', error);
        res.status(500).end();
    }
};

// Handle CORS preflight requests
const handleCorsOptions = (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Range, Accept-Encoding, Accept-Ranges, Content-Type');
    res.setHeader('Access-Control-Max-Age', '86400'); // 24 hours
    res.status(200).end();
};

// View video (embed/share page)
const viewVideo = (req, res) => {
    const { videoId } = req.params;
    
    // Check if video exists
    const videoData = videoStore.get(videoId);
    if (!videoData) {
        return res.status(404).send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Video Not Found - VillainArc</title>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <style>
                    * { margin: 0; padding: 0; box-sizing: border-box; }
                    body { 
                        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
                        background: linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 50%, #1a1a1a 100%);
                        color: #fff; 
                        min-height: 100vh;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                    }
                    .error-container {
                        text-align: center;
                        padding: 2rem;
                        background: rgba(255, 255, 255, 0.05);
                        border-radius: 12px;
                        border: 1px solid rgba(255, 255, 255, 0.1);
                        backdrop-filter: blur(10px);
                    }
                    .error { color: #ff6b6b; font-size: 2rem; margin-bottom: 1rem; }
                    .back-link { 
                        color: #5865f2; 
                        text-decoration: none; 
                        font-weight: 600;
                        padding: 0.8rem 2rem;
                        background: linear-gradient(135deg, #5865f2 0%, #4f46e5 100%);
                        border-radius: 8px;
                        display: inline-block;
                        margin-top: 1rem;
                        transition: all 0.3s ease;
                    }
                    .back-link:hover { transform: translateY(-2px); }
                </style>
            </head>
            <body>
                <div class="error-container">
                    <h1 class="error">Video Not Found</h1>
                    <p>The video you're looking for doesn't exist or has been removed.</p>
                    <a href="${process.env.FRONTEND_URL || '/'}" class="back-link">Go back to upload</a>
                </div>
            </body>
            </html>
        `);
    }

    const baseUrl = getBaseUrl(req);
    const videoUrl = `${baseUrl}/stream/${videoId}`;
    const downloadUrl = `${baseUrl}/download/${videoId}`;
    
    // Get uploader info and avatar URL
    const { userStore } = require('../config/database');
    const storedUser = userStore.get(videoData.uploadedBy);
    const uploaderUser = storedUser || {
        id: videoData.uploadedBy,
        username: videoData.uploaderUsername,
        avatar: videoData.uploaderAvatar,
        discriminator: '0'
    };
    
    // Enhanced Discord avatar URL function
    function getDiscordAvatarUrl(user) {
        if (!user) return 'https://cdn.discordapp.com/embed/avatars/0.png';
        
        if (user.avatar && user.id) {
            // If avatar is already a full URL, return it
            if (user.avatar.startsWith('http')) {
                return user.avatar;
            }
            
            // Handle Discord avatar hash - check for animated avatars
            const extension = user.avatar.startsWith('a_') ? 'gif' : 'png';
            return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${extension}?size=128`;
        }
        
        // Better fallback calculation for users without custom avatars
        if (user.discriminator && user.discriminator !== '0') {
            // Old discriminator system
            const discriminatorNum = parseInt(user.discriminator) % 5;
            return `https://cdn.discordapp.com/embed/avatars/${discriminatorNum}.png`;
        } else {
            // New username system (no discriminator) or fallback
            const userIdNum = user.id ? (parseInt(user.id) >> 22) % 6 : 0;
            return `https://cdn.discordapp.com/embed/avatars/${userIdNum}.png`;
        }
    }

    // Helper function for formatting file sizes
    function formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    const avatarUrl = getDiscordAvatarUrl(uploaderUser);

    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>${videoData.originalName} - VillainArc</title>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <meta property="og:title" content="${videoData.originalName}">
            <meta property="og:type" content="video.other">
            <meta property="og:video" content="${videoUrl}">
            <meta property="og:video:secure_url" content="${videoUrl}">
            <meta property="og:video:type" content="${videoData.contentType}">
            <meta property="twitter:card" content="player">
            <meta property="twitter:player" content="${req.protocol}://${req.get('host')}/v/${videoId}">
            <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
            <style>
                * {
                    margin: 0;
                    padding: 0;
                    box-sizing: border-box;
                }
                
                body {
                    font-family: 'Inter', sans-serif;
                    background: linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 50%, #1a1a1a 100%);
                    color: #ffffff;
                    min-height: 100vh;
                    -webkit-font-smoothing: antialiased;
                    -moz-osx-font-smoothing: grayscale;
                }
                
                /* Scrollbar */
                ::-webkit-scrollbar {
                    width: 6px;
                    background: #1a1a1a;
                }
                
                ::-webkit-scrollbar-thumb {
                    background: #333333;
                    border-radius: 3px;
                }
                
                ::-webkit-scrollbar-thumb:hover {
                    background: #444444;
                }
                
                /* Header */
                .header {
                    background: rgba(0, 0, 0, 0.6);
                    backdrop-filter: blur(12px);
                    border-bottom: 1px solid rgba(255, 255, 255, 0.15);
                    padding: 1rem 0;
                    position: sticky;
                    top: 0;
                    z-index: 100;
                }
                
                .header-content {
                    max-width: 1200px;
                    margin: 0 auto;
                    padding: 0 2rem;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }
                
                .logo {
                    display: flex;
                    align-items: center;
                    gap: 0.5rem;
                }
                
                .logo-image {
                    width: 40px;
                    height: 40px;
                    background: linear-gradient(135deg, #5865f2 0%, #4f46e5 100%);
                    border-radius: 8px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-weight: 700;
                    font-size: 1rem;
                    color: white;
                }
                
                .logo-text {
                    font-size: 1.2rem;
                    font-weight: 600;
                    color: #ffffff;
                }
                
                .back-btn {
                    background: rgba(255, 255, 255, 0.1);
                    border: 1px solid rgba(255, 255, 255, 0.2);
                    color: white;
                    padding: 0.5rem 1rem;
                    border-radius: 6px;
                    cursor: pointer;
                    transition: all 0.3s ease;
                    display: flex;
                    align-items: center;
                    gap: 0.5rem;
                    font-weight: 500;
                    text-decoration: none;
                    font-size: 0.9rem;
                }
                
                .back-btn:hover {
                    background: rgba(255, 255, 255, 0.2);
                    transform: translateY(-1px);
                }
                
                /* Main Content */
                .main-content {
                    max-width: 1000px;
                    margin: 0 auto;
                    padding: 2rem;
                }
                
                .video-container {
                    background: rgba(0, 0, 0, 0.3);
                    backdrop-filter: blur(12px);
                    border: 1px solid rgba(255, 255, 255, 0.1);
                    border-radius: 12px;
                    padding: 1.5rem;
                    margin-bottom: 1.5rem;
                }
                
                .video-title {
                    font-size: 1.5rem;
                    font-weight: 600;
                    color: #ffffff;
                    margin-bottom: 1rem;
                    word-break: break-word;
                }
                
                video {
                    width: 100%;
                    max-width: 100%;
                    height: auto;
                    border-radius: 8px;
                    background: #000000;
                }
                
                /* Video Info Cards */
                .info-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
                    gap: 1rem;
                    margin-bottom: 1.5rem;
                }
                
                .info-card {
                    background: rgba(0, 0, 0, 0.3);
                    backdrop-filter: blur(12px);
                    border: 1px solid rgba(255, 255, 255, 0.1);
                    border-radius: 12px;
                    padding: 1.5rem;
                }
                
                .card-title {
                    font-size: 0.9rem;
                    font-weight: 500;
                    color: rgba(255, 255, 255, 0.7);
                    margin-bottom: 0.75rem;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                }
                
                .uploader-info {
                    display: flex;
                    align-items: center;
                    gap: 0.75rem;
                }
                
                .uploader-avatar {
                    width: 48px;
                    height: 48px;
                    border-radius: 50%;
                    border: 2px solid rgba(255, 255, 255, 0.2);
                    overflow: hidden;
                }
                
                .uploader-avatar img {
                    width: 100%;
                    height: 100%;
                    object-fit: cover;
                }
                
                .uploader-details h3 {
                    font-size: 1.1rem;
                    font-weight: 600;
                    color: #ffffff;
                    margin-bottom: 0.25rem;
                }
                
                .uploader-details p {
                    font-size: 0.85rem;
                    color: rgba(255, 255, 255, 0.7);
                }
                
                .file-stats {
                    display: flex;
                    flex-direction: column;
                    gap: 0.5rem;
                }
                
                .stat-item {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }
                
                .stat-label {
                    font-size: 0.9rem;
                    color: rgba(255, 255, 255, 0.7);
                }
                
                .stat-value {
                    font-size: 0.9rem;
                    font-weight: 600;
                    color: #ffffff;
                }
                
                /* Actions */
                .actions {
                    display: flex;
                    gap: 1rem;
                    flex-wrap: wrap;
                }
                
                .btn {
                    background: linear-gradient(135deg, #5865f2, #4752c4);
                    color: white;
                    padding: 0.75rem 2rem;
                    border: none;
                    border-radius: 50px;
                    text-decoration: none;
                    font-weight: 600;
                    font-size: 0.9rem;
                    transition: all 0.3s ease;
                    display: inline-flex;
                    align-items: center;
                    gap: 0.5rem;
                    box-shadow: 0 4px 20px rgba(88, 101, 242, 0.4);
                    cursor: pointer;
                }
                
                .btn:hover {
                    background: linear-gradient(135deg, #4752c4, #3b41a3);
                    transform: translateY(-2px);
                    box-shadow: 0 6px 25px rgba(88, 101, 242, 0.5);
                }
                
                .btn-secondary {
                    background: rgba(255, 255, 255, 0.1);
                    box-shadow: none;
                    border: 1px solid rgba(255, 255, 255, 0.2);
                }
                
                .btn-secondary:hover {
                    background: rgba(255, 255, 255, 0.2);
                    box-shadow: 0 4px 15px rgba(255, 255, 255, 0.1);
                }
                
                /* Mobile Responsive */
                @media (max-width: 768px) {
                    .main-content {
                        padding: 1rem;
                    }
                    
                    .header-content {
                        padding: 0 1rem;
                    }
                    
                    .video-container {
                        padding: 1rem;
                    }
                    
                    .video-title {
                        font-size: 1.2rem;
                    }
                    
                    .info-grid {
                        grid-template-columns: 1fr;
                        gap: 1rem;
                    }
                    
                    .actions {
                        flex-direction: column;
                    }
                    
                    .btn {
                        justify-content: center;
                        width: 100%;
                    }
                }
            </style>
        </head>
        <body>
            <div class="header">
                <div class="header-content">
                    <div class="logo">
                        <div class="logo-image">VA</div>
                        <div class="logo-text">VillainArc</div>
                    </div>
                    <a href="${process.env.FRONTEND_URL || '/'}" class="back-btn">
                        ← Back to Upload
                    </a>
                </div>
            </div>
            
            <div class="main-content">
                <div class="video-container">
                    <h1 class="video-title">${videoData.originalName}</h1>
                    <div class="video-wrapper" style="position: relative;">
                        <video 
                            id="mainVideo"
                            controls 
                            preload="metadata"
                            crossorigin="anonymous"
                            style="width: 100%; max-width: 100%; height: auto; border-radius: 8px; background: #000000;">
                            <source src="${videoUrl}" type="${videoData.fileFormat === '.mkv' || videoData.isMKV ? 'video/mp4' : videoData.contentType}">
                            <p style="color: #ff6b6b; text-align: center; padding: 2rem;">
                                Your browser does not support the video tag. 
                                <a href="${downloadUrl}" style="color: #5865f2;">Download the video instead</a>
                            </p>
                        </video>
                        <div id="loadingStatus" style="display: none; position: absolute; top: 10px; right: 10px; background: rgba(0,0,0,0.8); color: white; padding: 0.5rem; border-radius: 4px; font-size: 0.8rem;">
                            Loading...
                        </div>
                    </div>
                </div>
                
                <div class="info-grid">
                    <div class="info-card">
                        <div class="card-title">Uploaded by</div>
                        <div class="uploader-info">
                            <div class="uploader-avatar">
                                <img id="avatarImg" src="${avatarUrl}"
                                     alt="${videoData.uploaderUsername}"
                                     style="width: 100%; height: 100%; object-fit: cover;">
                            </div>
                            <div class="uploader-details">
                                <h3>${videoData.uploaderUsername}</h3>
                                <p>Discord User</p>
                            </div>
                        </div>
                    </div>
                    
                    <div class="info-card">
                        <div class="card-title">File Details</div>
                        <div class="file-stats">
                            <div class="stat-item">
                                <span class="stat-label">File Size:</span>
                                <span class="stat-value">${formatFileSize(videoData.size)}</span>
                            </div>
                            <div class="stat-item">
                                <span class="stat-label">Upload Date:</span>
                                <span class="stat-value">${new Date(videoData.uploadDate).toLocaleDateString()}</span>
                            </div>
                            <div class="stat-item">
                                <span class="stat-label">Downloads:</span>
                                <span class="stat-value">${videoData.downloadCount}</span>
                            </div>
                        </div>
                    </div>
                </div>
                
                <div class="actions">
                    <a href="${downloadUrl}" class="btn">
                        📥 Download Video
                    </a>
                    <a href="${process.env.FRONTEND_URL || '/'}" class="btn btn-secondary">
                        📤 Upload Another
                    </a>
                </div>
            </div>
            <script>
                // Simple video loading with MKV support
                const video = document.getElementById('mainVideo');
                const loadingStatus = document.getElementById('loadingStatus');
                const avatarImg = document.getElementById('avatarImg');
                
                // Check if this is an MKV file
                const isMKV = '${videoData.fileFormat}' === '.mkv' || ${videoData.isMKV || false};
                
                // Handle avatar image error
                if (avatarImg) {
                    avatarImg.addEventListener('error', function() {
                        this.src = 'https://cdn.discordapp.com/embed/avatars/0.png';
                    });
                }
                
                if (video && loadingStatus) {
                    // Force video to try multiple formats for MKV compatibility
                    if (isMKV) {
                        console.log('🎬 MKV file detected - setting up enhanced compatibility');
                        
                        // Add multiple source elements for better compatibility
                        const videoUrl = '${videoUrl}';
                        video.innerHTML = \`
                            <source src="\${videoUrl}" type="video/mp4">
                            <source src="\${videoUrl}" type="video/x-matroska">
                            <source src="\${videoUrl}" type="video/webm">
                            <p style="color: #ff6b6b; text-align: center; padding: 2rem;">
                                Your browser does not support this video format. 
                                <a href="${downloadUrl}" style="color: #5865f2;">Download the video instead</a>
                            </p>
                        \`;
                        
                        // Set video properties for better MKV handling
                        video.preload = 'metadata';
                        video.crossOrigin = 'anonymous';
                    }
                    
                    // Show loading status
                    video.addEventListener('loadstart', () => {
                        console.log('🎥 Video loading started');
                        loadingStatus.textContent = 'Loading...';
                        loadingStatus.style.display = 'block';
                    });
                    
                    video.addEventListener('loadedmetadata', () => {
                        console.log('📊 Video metadata loaded, duration:', video.duration);
                        loadingStatus.textContent = 'Metadata loaded';
                    });
                    
                    video.addEventListener('loadeddata', () => {
                        console.log('📁 Video data loaded');
                        loadingStatus.textContent = 'Data loaded';
                    });
                    
                    video.addEventListener('canplay', () => {
                        console.log('▶️ Video can start playing');
                        loadingStatus.style.display = 'none';
                    });
                    
                    video.addEventListener('canplaythrough', () => {
                        console.log('🎬 Video can play through');
                        loadingStatus.style.display = 'none';
                    });
                    
                    video.addEventListener('progress', () => {
                        if (video.buffered.length > 0) {
                            const buffered = video.buffered.end(0);
                            const duration = video.duration;
                            if (duration > 0) {
                                const percent = Math.round((buffered / duration) * 100);
                                if (loadingStatus.style.display !== 'none') {
                                    loadingStatus.textContent = \`Buffered: \${percent}%\`;
                                }
                            }
                        }
                    });
                    
                    video.addEventListener('error', async (e) => {
                        console.error('❌ Video error:', e);
                        const error = video.error;
                        
                        let errorMessage = 'Error loading video';
                        
                        if (error) {
                            switch(error.code) {
                                case error.MEDIA_ERR_ABORTED:
                                    errorMessage = 'Video loading was aborted';
                                    break;
                                case error.MEDIA_ERR_NETWORK:
                                    errorMessage = 'Network error while loading video';
                                    break;
                                case error.MEDIA_ERR_DECODE:
                                    errorMessage = 'Video format not supported by your browser';
                                    break;
                                case error.MEDIA_ERR_SRC_NOT_SUPPORTED:
                                    errorMessage = 'Video source not supported';
                                    break;
                                default:
                                    errorMessage = 'Unknown video error occurred';
                            }
                        }
                        
                        loadingStatus.innerHTML = \`
                            <div style="color: #ff6b6b;">
                                ❌ \${errorMessage}<br>
                                <a href="${downloadUrl}" style="color: #5865f2; text-decoration: underline;">Download instead</a>
                            </div>
                        \`;
                        loadingStatus.style.display = 'block';
                    });
                    
                    // Test if the stream URL is accessible
                    console.log('🔗 Testing stream URL:', videoUrl);
                    fetch(videoUrl, { 
                        method: 'HEAD',
                        mode: 'cors'
                    })
                    .then(response => {
                        console.log('📡 Stream URL test response:', response.status, response.statusText);
                        console.log('📋 Response headers:', Array.from(response.headers.entries()));
                        if (!response.ok) {
                            throw new Error(\`Stream not accessible: \${response.status} \${response.statusText}\`);
                        }
                    })
                    .catch(error => {
                        console.error('🚫 Stream URL test failed:', error);
                        loadingStatus.innerHTML = \`
                            <div style="color: #ff6b6b;">
                                🚫 Stream not accessible<br>
                                <a href="${downloadUrl}" style="color: #5865f2; text-decoration: underline;">Download instead</a>
                            </div>
                        \`;
                        loadingStatus.style.display = 'block';
                    });
                }
            </script>
        </body>
        </html>
    `);
};

// Download video
const downloadVideo = async (req, res) => {
    try {
        const { videoId } = req.params;
        const videoData = videoStore.get(videoId);
        
        if (!videoData) {
            return res.status(404).json({ error: 'Video not found' });
        }

        // Generate download URL and redirect
        const downloadUrl = await generateStreamUrl(videoId);
        
        // Update download count
        videoData.downloadCount = (videoData.downloadCount || 0) + 1;
        videoStore.set(videoId, videoData);
        
        // Set download headers and redirect
        res.setHeader('Content-Disposition', `attachment; filename="${videoData.originalName}"`);
        res.redirect(downloadUrl);
        
    } catch (error) {
        console.error('❌ Download error:', error);
        res.status(500).json({ error: 'Failed to generate download link' });
    }
};

module.exports = {
    uploadVideo,
    streamVideo,
    getVideoHead,
    handleCorsOptions,
    viewVideo,
    downloadVideo
};
