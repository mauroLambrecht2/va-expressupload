// Load environment variables first
require('dotenv').config();

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const { v2: cloudinary } = require('cloudinary');

// Configure Cloudinary
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Debug: Check if Cloudinary is configured
console.log('🔧 Cloudinary Config Check:');
console.log('Cloud Name:', process.env.CLOUDINARY_CLOUD_NAME ? '✅ Set' : '❌ Missing');
console.log('API Key:', process.env.CLOUDINARY_API_KEY ? '✅ Set' : '❌ Missing');
console.log('API Secret:', process.env.CLOUDINARY_API_SECRET ? '✅ Set' : '❌ Missing');

const app = express();
// Always use 8000 for development, let hosting platforms set PORT in production
const PORT = process.env.PORT || 8000;
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

// Middleware - Enhanced Security with Cloudinary support
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:", "blob:", "https://res.cloudinary.com"],
            mediaSrc: ["'self'", "blob:", "https://res.cloudinary.com"], // Allow Cloudinary videos
            connectSrc: ["'self'"],
            fontSrc: ["'self'", "https://fonts.googleapis.com", "https://fonts.gstatic.com"],
            objectSrc: ["'none'"],
            upgradeInsecureRequests: [],
        },
    },
    crossOriginEmbedderPolicy: false,
}));

// Strict CORS for production
const allowedOrigins = process.env.NODE_ENV === 'production' 
    ? [process.env.FRONTEND_URL, process.env.BACKEND_URL].filter(Boolean)
    : true;

console.log('🔧 CORS Configuration:');
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('Allowed Origins:', allowedOrigins);

app.use(cors({
    origin: allowedOrigins,
    credentials: true,
    optionsSuccessStatus: 200
}));
app.use(morgan('combined'));
// Remove JSON/URLencoded limits for file uploads - multer handles the file size limit
app.use(express.json({ limit: '1mb' })); // Keep small for non-file requests
app.use(express.urlencoded({ extended: true, limit: '1mb' })); // Keep small for non-file requests

// Add detailed request logging for debugging
app.use((req, res, next) => {
    console.log(`🌐 ${req.method} ${req.path} - Origin: ${req.get('origin')} - IP: ${req.ip}`);
    
    if (req.path === '/upload') {
        console.log(`📤 Upload request details:`, {
            method: req.method,
            path: req.path,
            origin: req.get('origin'),
            contentType: req.get('content-type'),
            contentLength: req.get('content-length'),
            userAgent: req.get('user-agent')
        });
    }
    next();
});

// Serve React build in production
if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.join(__dirname, 'client/build')));
} else {
    app.use(express.static('public'));
}

// Rate limiting - More restrictive for production
const uploadLimit = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: process.env.NODE_ENV === 'production' ? 5 : 10, // 5 uploads in prod, 10 in dev
    message: { error: 'Too many uploads from this IP, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
});

// General API rate limiting
const apiLimit = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 100, // 100 requests per minute
    message: { error: 'Too many requests, please slow down.' },
    standardHeaders: true,
    legacyHeaders: false,
});

app.use('/api', apiLimit);

// Storage configuration - Use memory storage for Cloudinary upload
const storage = multer.memoryStorage();

// Enhanced file filter with virus scanning simulation
const fileFilter = (req, file, cb) => {
    const allowedTypes = [
        'video/mp4', 'video/webm', 'video/ogg', 'video/quicktime', 
        'video/x-matroska', 'video/x-msvideo', 'video/x-flv', 'video/x-ms-wmv'
    ];
    const allowedExtensions = ['.mp4', '.webm', '.ogg', '.mov', '.mkv', '.avi', '.flv', '.wmv'];
    
    const fileExtension = path.extname(file.originalname).toLowerCase();
      // Check MIME type AND file extension for double security
    if (allowedTypes.includes(file.mimetype) && allowedExtensions.includes(fileExtension)) {
        // More permissive filename validation - allow spaces and common characters
        const basename = path.basename(file.originalname, fileExtension);
        // Block dangerous characters but allow spaces, parentheses, brackets, etc.
        if (/[<>:"|?*\\\/]/.test(basename) || basename.trim() === '') {
            cb(new Error('Filename contains invalid characters!'), false);
            return;
        }
        cb(null, true);
    } else {
        cb(new Error('Only video files are allowed! Detected type: ' + file.mimetype), false);
    }
};

const upload = multer({ 
    storage,
    fileFilter,
    limits: {
        fileSize: 100 * 1024 * 1024 // 100MB - works reliably with Cloudinary
    }
});

// In-memory store for video metadata (in production, use a database)
const videoStore = new Map();

// Routes - Secure upload endpoint
app.post('/upload', uploadLimit, upload.single('video'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No video file uploaded' });
        }

        // Generate cryptographically secure video ID
        const videoId = crypto.randomBytes(16).toString('hex');        console.log(`📤 Uploading to Cloudinary: ${req.file.originalname} (${req.file.size} bytes)`);        // Upload to Cloudinary with minimal parameters to avoid sync processing
        const uploadResult = await new Promise((resolve, reject) => {
            cloudinary.uploader.upload_stream(
                {
                    resource_type: 'video',
                    public_id: `villainarc_clips_${videoId}`, // Flattened naming to avoid nested folders
                    folder: 'villainarc/clips',
                    use_filename: false,
                    unique_filename: true,
                    overwrite: false
                    // Removed quality and format to avoid incoming transformations
                },
                (error, result) => {
                    if (error) {
                        console.error('Cloudinary upload error:', error);
                        reject(error);
                    } else {
                        console.log('✅ Cloudinary upload successful:', result.public_id);
                        resolve(result);
                    }
                }
            ).end(req.file.buffer);
        });

        const videoData = {
            id: videoId,
            originalName: req.file.originalname,
            cloudinaryUrl: uploadResult.secure_url,
            cloudinaryPublicId: uploadResult.public_id,
            size: req.file.size,
            duration: uploadResult.duration,
            format: uploadResult.format,
            uploadDate: new Date(),
            downloadCount: 0,
            ip: req.ip
        };

        videoStore.set(videoId, videoData);

        const baseUrl = process.env.NODE_ENV === 'production' 
            ? process.env.BACKEND_URL || `${req.protocol}://${req.get('host')}`
            : `${req.protocol}://${req.get('host')}`;
            
        const shareLink = `${baseUrl}/v/${videoId}`;
        const downloadLink = `${baseUrl}/download/${videoId}`;
        const previewUrl = uploadResult.secure_url; // Direct Cloudinary URL

        // Send Discord webhook (if URL is properly configured)
        if (DISCORD_WEBHOOK_URL && DISCORD_WEBHOOK_URL.startsWith('https://discord.com/api/webhooks/')) {
            try {
                await sendDiscordWebhook(shareLink, videoData);
            } catch (webhookError) {
                console.error('Discord webhook failed:', webhookError.message);
                // Don't fail upload if webhook fails
            }
        }

        res.json({
            success: true,
            id: videoId,
            shareLink,
            downloadUrl: downloadLink,
            previewUrl,
            filename: videoData.originalName,
            size: videoData.size,
            duration: videoData.duration
        });    } catch (error) {
        console.error('Upload error:', error);
        
        // Handle specific Cloudinary errors
        if (error.message && error.message.includes('File size too large')) {
            return res.status(413).json({ error: 'File too large for upload. Try a smaller file.' });
        }
        
        if (error.message && error.message.includes('Invalid video file')) {
            return res.status(400).json({ error: 'Invalid video file format.' });
        }
        
        if (error.message && error.message.includes('Upload failed')) {
            return res.status(500).json({ error: 'Upload to cloud storage failed. Please try again.' });
        }
        
        res.status(500).json({ error: 'Upload failed: ' + error.message });
    }
});

app.get('/v/:videoId', (req, res) => {
    const { videoId } = req.params;
    const videoData = videoStore.get(videoId);

    if (!videoData) {
        return res.status(404).send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Video Not Found</title>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <style>
                    body { 
                        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
                        background: #1a1a1a; 
                        color: #fff; 
                        text-align: center; 
                        padding: 50px; 
                    }
                    .error { color: #ff6b6b; }
                </style>
            </head>
            <body>
                <h1 class="error">Video Not Found</h1>
                <p>The video you're looking for doesn't exist or has been removed.</p>
                <a href="/" style="color: #4dabf7;">Go back to upload</a>
            </body>
            </html>
        `);    }

    const videoUrl = videoData.cloudinaryUrl; // Direct Cloudinary URL
    const downloadUrl = `/download/${videoId}`;

    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>${videoData.originalName} - Video Share</title>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <meta property="og:title" content="${videoData.originalName}">
            <meta property="og:type" content="video.other">
            <meta property="og:video" content="${req.protocol}://${req.get('host')}${videoUrl}">
            <meta property="og:video:secure_url" content="${req.protocol}://${req.get('host')}${videoUrl}">
            <meta property="og:video:type" content="video/mp4">
            <meta property="twitter:card" content="player">
            <meta property="twitter:player" content="${req.protocol}://${req.get('host')}/v/${videoId}">
            <style>
                body { 
                    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
                    background: #1a1a1a; 
                    color: #fff; 
                    margin: 0; 
                    padding: 20px; 
                }
                .container { 
                    max-width: 800px; 
                    margin: 0 auto; 
                    text-align: center; 
                }
                video { 
                    width: 100%; 
                    max-width: 100%; 
                    height: auto; 
                    border-radius: 8px; 
                    box-shadow: 0 4px 12px rgba(0,0,0,0.3); 
                }
                .info { 
                    margin: 20px 0; 
                    padding: 20px; 
                    background: #2d2d2d; 
                    border-radius: 8px; 
                }
                .download-btn { 
                    background: #4dabf7; 
                    color: white; 
                    padding: 12px 24px; 
                    border: none; 
                    border-radius: 6px; 
                    text-decoration: none; 
                    display: inline-block; 
                    margin: 10px; 
                    transition: background 0.3s; 
                }
                .download-btn:hover { 
                    background: #339af0; 
                }
                .back-btn { 
                    background: #6c757d; 
                    color: white; 
                    padding: 8px 16px; 
                    border: none; 
                    border-radius: 6px; 
                    text-decoration: none; 
                    display: inline-block; 
                    margin: 10px; 
                }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>${videoData.originalName}</h1>
                <video controls preload="metadata">
                    <source src="${videoUrl}" type="video/mp4">
                    Your browser does not support the video tag.
                </video>
                <div class="info">
                    <p><strong>File size:</strong> ${(videoData.size / (1024 * 1024)).toFixed(2)} MB</p>
                    <p><strong>Uploaded:</strong> ${videoData.uploadDate.toLocaleString()}</p>
                    <p><strong>Downloads:</strong> ${videoData.downloadCount}</p>
                </div>
                <a href="${downloadUrl}" class="download-btn">Download Video</a>
                <a href="/" class="back-btn">Upload Another</a>
            </div>
        </body>
        </html>
    `);
});

app.get('/stream/:videoId', (req, res) => {
    const { videoId } = req.params;
    const videoData = videoStore.get(videoId);

    if (!videoData) {
        return res.status(404).json({ error: 'Video not found' });
    }

    // Redirect to Cloudinary streaming URL
    res.redirect(videoData.cloudinaryUrl);
});

app.get('/download/:videoId', (req, res) => {
    const { videoId } = req.params;
    const videoData = videoStore.get(videoId);

    if (!videoData) {
        return res.status(404).json({ error: 'Video not found' });
    }

    // Increment download count
    videoData.downloadCount++;
    videoStore.set(videoId, videoData);

    // Redirect to Cloudinary download URL with original filename
    const downloadUrl = cloudinary.url(videoData.cloudinaryPublicId, {
        resource_type: 'video',
        flags: 'attachment',
        secure: true
    });
    
    res.redirect(downloadUrl);
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        env: process.env.NODE_ENV || 'development'
    });
});

// Discord webhook function - Enhanced security
async function sendDiscordWebhook(shareLink, videoData) {
    if (!DISCORD_WEBHOOK_URL || !DISCORD_WEBHOOK_URL.startsWith('https://discord.com/api/webhooks/')) {
        return;
    }

    try {
        const response = await fetch(DISCORD_WEBHOOK_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                embeds: [{
                    title: '� VillainArc Clip Uploaded',
                    description: `**${videoData.originalName.substring(0, 100)}**${videoData.originalName.length > 100 ? '...' : ''}\n\n[🔗 View Clip](${shareLink})`,
                    color: 0x7f00ff, // VillainArc purple
                    fields: [
                        {
                            name: '📁 File Size',
                            value: `${(videoData.size / (1024 * 1024)).toFixed(2)} MB`,
                            inline: true
                        },
                        {
                            name: '📅 Upload Time',
                            value: new Date(videoData.uploadDate).toLocaleString(),
                            inline: true
                        },
                        {
                            name: '🎮 Guild',
                            value: 'VillainArc',
                            inline: true
                        }
                    ],
                    thumbnail: {
                        url: 'https://cdn.discordapp.com/emojis/your_guild_emoji.png' // Replace with your guild logo
                    },
                    timestamp: videoData.uploadDate.toISOString(),
                    footer: {
                        text: 'VillainArc Clip Sharing'
                    }
                }]
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
    } catch (error) {
        console.error('Discord webhook error:', error.message);
        throw error; // Re-throw to handle in upload route
    }
}

// Serve React app for production
if (process.env.NODE_ENV === 'production') {
    app.get('*', (req, res) => {
        res.sendFile(path.join(__dirname, 'client/build/index.html'));
    });
}

// Error handling middleware
app.use((error, req, res, next) => {
    console.error('Server error details:', {
        message: error.message,
        code: error.code,
        stack: error.stack.substring(0, 500)
    });
    
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: 'File too large. Maximum size is 250MB.' });
        }
        if (error.code === 'LIMIT_UNEXPECTED_FILE') {
            return res.status(400).json({ error: 'Unexpected file field.' });
        }
        return res.status(400).json({ error: `Upload error: ${error.message}` });
    }
    
    if (error.message && error.message.includes('Filename contains invalid characters')) {
        return res.status(400).json({ error: 'Filename contains invalid characters!' });
    }
    
    if (error.message && error.message.includes('Only video files are allowed')) {
        return res.status(400).json({ error: 'Only video files are allowed!' });
    }

    // Generic server errors
    res.status(500).json({ error: 'Upload failed. Please try again with a smaller file.' });
});

app.listen(PORT, () => {
    console.log(`🚀 Video sharing server running on http://localhost:${PORT}`);
    console.log(`📁 Upload directory: ${path.resolve('uploads')}`);
    if (DISCORD_WEBHOOK_URL) {
        console.log('🔗 Discord webhook configured');
    } else {
        console.log('⚠️  Discord webhook not configured (set DISCORD_WEBHOOK_URL environment variable)');
    }
}).timeout = 10 * 60 * 1000; // 10 minute timeout for large uploads
