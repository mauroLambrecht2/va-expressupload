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

const app = express();
// Production: Use platform-provided PORT (80/443), Development: Use 8000
const PORT = process.env.PORT || (process.env.NODE_ENV === 'production' ? 80 : 8000);
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

// Middleware - Enhanced Security
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:", "blob:"],
            mediaSrc: ["'self'", "blob:"],
            connectSrc: ["'self'"],
            fontSrc: ["'self'", "https://fonts.googleapis.com", "https://fonts.gstatic.com"],
            objectSrc: ["'none'"],
            upgradeInsecureRequests: [],
        },
    },
    crossOriginEmbedderPolicy: false,
}));

// Strict CORS for production
app.use(cors({
    origin: process.env.NODE_ENV === 'production' 
        ? [process.env.FRONTEND_URL, process.env.BACKEND_URL].filter(Boolean)
        : true,
    credentials: true,
    optionsSuccessStatus: 200
}));
app.use(morgan('combined'));
app.use(express.json({ limit: '250mb' }));
app.use(express.urlencoded({ extended: true, limit: '250mb' }));

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

// Storage configuration
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/');
    },
    filename: (req, file, cb) => {
        const uniqueId = uuidv4();
        const extension = path.extname(file.originalname);
        cb(null, `${uniqueId}${extension}`);
    }
});

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
        fileSize: 250 * 1024 * 1024 // 250MB
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
        const videoId = crypto.randomBytes(16).toString('hex');
        const originalFilename = req.file.filename;
        const newFilename = `${videoId}${path.extname(req.file.filename)}`;
        
        // Rename file to secure ID
        const oldPath = path.join('uploads', originalFilename);
        const newPath = path.join('uploads', newFilename);
        fs.renameSync(oldPath, newPath);

        const videoData = {
            id: videoId,
            originalName: req.file.originalname,
            filename: newFilename,
            size: req.file.size,
            uploadDate: new Date(),
            downloadCount: 0,
            ip: req.ip // Track for abuse prevention
        };

        videoStore.set(videoId, videoData);

        const baseUrl = process.env.NODE_ENV === 'production' 
            ? process.env.BACKEND_URL || `${req.protocol}://${req.get('host')}`
            : `${req.protocol}://${req.get('host')}`;
            
        const shareLink = `${baseUrl}/v/${videoId}`;
        const downloadLink = `${baseUrl}/download/${videoId}`;
        const previewUrl = `${baseUrl}/stream/${videoId}`;

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
            size: videoData.size
        });

    } catch (error) {
        console.error('Upload error:', error);
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
        `);
    }

    const videoUrl = `/stream/${videoId}`;
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

    const videoPath = path.join(__dirname, 'uploads', videoData.filename);
    
    if (!fs.existsSync(videoPath)) {
        return res.status(404).json({ error: 'Video file not found' });
    }

    const stat = fs.statSync(videoPath);
    const fileSize = stat.size;
    const range = req.headers.range;

    if (range) {
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunksize = (end - start) + 1;
        const file = fs.createReadStream(videoPath, { start, end });
        const head = {
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': chunksize,
            'Content-Type': 'video/mp4',
        };
        res.writeHead(206, head);
        file.pipe(res);
    } else {
        const head = {
            'Content-Length': fileSize,
            'Content-Type': 'video/mp4',
        };
        res.writeHead(200, head);
        fs.createReadStream(videoPath).pipe(res);
    }
});

app.get('/download/:videoId', (req, res) => {
    const { videoId } = req.params;
    const videoData = videoStore.get(videoId);

    if (!videoData) {
        return res.status(404).json({ error: 'Video not found' });
    }

    const videoPath = path.join(__dirname, 'uploads', videoData.filename);
    
    if (!fs.existsSync(videoPath)) {
        return res.status(404).json({ error: 'Video file not found' });
    }

    // Increment download count
    videoData.downloadCount++;
    videoStore.set(videoId, videoData);    res.download(videoPath, videoData.originalName);
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
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: 'File too large. Maximum size is 100MB.' });
        }
    }
    
    if (error.message === 'Only video files are allowed!') {
        return res.status(400).json({ error: 'Only video files are allowed!' });
    }

    console.error('Server error:', error);
    res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
    console.log(`🚀 Video sharing server running on http://localhost:${PORT}`);
    console.log(`📁 Upload directory: ${path.resolve('uploads')}`);
    if (DISCORD_WEBHOOK_URL) {
        console.log('🔗 Discord webhook configured');
    } else {
        console.log('⚠️  Discord webhook not configured (set DISCORD_WEBHOOK_URL environment variable)');
    }
});
