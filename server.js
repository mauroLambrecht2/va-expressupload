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
const { BlobServiceClient, StorageSharedKeyCredential, generateBlobSASQueryParameters, BlobSASPermissions } = require('@azure/storage-blob');
const { TableClient, AzureNamedKeyCredential } = require('@azure/data-tables');
const session = require('express-session');
const passport = require('passport');
const { setupDiscordAuth, requireAuth, checkUploadQuota, recordUpload } = require('./auth');
// Removed FFmpeg dependencies - no temp files needed

// Configure Azure Blob Storage
const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME;
const accountKey = process.env.AZURE_STORAGE_ACCOUNT_KEY;
const containerName = process.env.AZURE_STORAGE_CONTAINER || 'videos';

let blobServiceClient;
let sharedKeyCredential;
if (accountName && accountKey) {
    sharedKeyCredential = new StorageSharedKeyCredential(accountName, accountKey);
    blobServiceClient = new BlobServiceClient(
        `https://${accountName}.blob.core.windows.net`,
        sharedKeyCredential
    );
}

// Debug: Check if Azure is configured
console.log('🔧 Azure Blob Storage Config Check:');
console.log('Account Name:', accountName ? '✅ Set' : '❌ Missing');
console.log('Account Key:', accountKey ? '✅ Set' : '❌ Missing');
console.log('Container:', containerName);

const app = express();
// Always use 8000 for development, let hosting platforms set PORT in production
const PORT = process.env.PORT || 8000;
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

// Middleware - Enhanced Security with proper CSP for fonts, images, and scripts
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            imgSrc: [
                "'self'", 
                "data:", 
                "blob:", 
                "https://*.blob.core.windows.net",
                "https://cdn.discordapp.com"
            ],
            mediaSrc: ["'self'", "blob:", "https://*.blob.core.windows.net"],
            connectSrc: ["'self'", "https://*.blob.core.windows.net", "https://unpkg.com"], // Allow FFmpeg downloads
            fontSrc: [
                "'self'", 
                "https://fonts.googleapis.com", 
                "https://fonts.gstatic.com"
            ],
            objectSrc: ["'none'"],
            upgradeInsecureRequests: [],
            workerSrc: ["'self'", "blob:"], // Allow web workers for FFmpeg
        },
    },
    crossOriginEmbedderPolicy: false,
}));

// Secure CORS configuration for production deployment
const allowedOrigins = process.env.NODE_ENV === 'production' 
    ? [
        process.env.FRONTEND_URL, 
        process.env.BACKEND_URL,
        // Add your production domains here
        'https://your-app-name.onrender.com',
        'https://your-app-name.herokuapp.com',
        'https://your-app-name.railway.app'
      ].filter(Boolean)
    : [
        'http://localhost:3000', // React dev server
        'http://localhost:8000', // Backend server
        'http://127.0.0.1:3000'  // Alternative localhost
      ];

console.log('🔧 CORS Configuration:');
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('Allowed Origins:', allowedOrigins);

app.use(cors({
    origin: allowedOrigins,
    credentials: true,
    optionsSuccessStatus: 200
}));

// Session middleware for Discord OAuth2 - Persistent sessions with Azure Table Storage
const sessionSecret = process.env.SESSION_SECRET || (() => {
    // Generate a consistent secret based on environment for development
    if (process.env.NODE_ENV !== 'production') {
        console.log('⚠️  No SESSION_SECRET found - using development fallback');
        console.log('💡 Add SESSION_SECRET to your .env file for persistent sessions');
        return 'dev-session-secret-' + (process.env.AZURE_STORAGE_ACCOUNT_NAME || 'default');
    }
    // In production, require a proper secret
    throw new Error('SESSION_SECRET environment variable is required in production');
})();

// Custom Azure Table Storage session store
class AzureTableSessionStore extends session.Store {
    constructor(options = {}) {
        super();
        this.tableName = options.tableName || 'sessions';
        this.ttl = options.ttl || 7 * 24 * 60 * 60 * 1000; // 7 days
        
        if (accountName && accountKey) {
            const credential = new AzureNamedKeyCredential(accountName, accountKey);
            this.tableClient = new TableClient(
                `https://${accountName}.table.core.windows.net`,
                this.tableName,
                credential
            );
            this.initialized = false;
            this.init();
        } else {
            console.log('⚠️  Azure credentials not available for session store');
            this.tableClient = null;
        }
    }
    
    async init() {
        if (!this.tableClient || this.initialized) return;
        
        try {
            await this.tableClient.createTable();
            console.log(`✅ Azure Table '${this.tableName}' ready for sessions`);
            this.initialized = true;
        } catch (error) {
            if (error.statusCode === 409) {
                // Table already exists
                console.log(`✅ Azure Table '${this.tableName}' already exists`);
                this.initialized = true;
            } else {
                console.error('❌ Failed to initialize Azure session table:', error.message);
            }
        }
    }
      async get(sessionId, callback) {
        if (!this.tableClient) {
            console.error('❌ Azure Table client not available for session get');
            return callback(new Error('Azure Table client not available'));
        }
        
        try {
            console.log(`🔍 Getting session from Azure: ${sessionId}`);
            const entity = await this.tableClient.getEntity('session', sessionId);
            const sessionData = JSON.parse(entity.data);
            
            // Check if session is expired
            if (entity.expires && new Date(entity.expires) < new Date()) {
                console.log(`⏰ Session expired: ${sessionId}`);
                await this.destroy(sessionId, () => {});
                return callback();
            }
            
            console.log(`✅ Session found in Azure: ${sessionId}`);
            callback(null, sessionData);
        } catch (error) {
            if (error.statusCode === 404) {
                console.log(`🔍 Session not found in Azure: ${sessionId}`);
                callback(); // Session not found
            } else {
                console.error('❌ Error getting session from Azure:', error.message);
                callback(error);
            }
        }
    }
      async set(sessionId, session, callback) {
        if (!this.tableClient) {
            console.error('❌ Azure Table client not available for session save');
            return callback(new Error('Azure Table client not available'));
        }
        
        try {
            console.log(`💾 Saving session to Azure: ${sessionId}`);
            const expires = new Date(Date.now() + this.ttl);
            const entity = {
                partitionKey: 'session',
                rowKey: sessionId,
                data: JSON.stringify(session),
                expires: expires.toISOString(),
                timestamp: new Date().toISOString()
            };
            
            await this.tableClient.upsertEntity(entity);
            console.log(`✅ Session saved to Azure successfully: ${sessionId}`);
            callback();
        } catch (error) {
            console.error('❌ Error saving session to Azure:', error.message);
            callback(error);
        }
    }
    
    async destroy(sessionId, callback) {
        if (!this.tableClient) {
            return callback(new Error('Azure Table client not available'));
        }
        
        try {
            await this.tableClient.deleteEntity('session', sessionId);
            callback();
        } catch (error) {
            if (error.statusCode === 404) {
                callback(); // Session not found, that's fine
            } else {
                console.error('❌ Error destroying session in Azure:', error.message);
                callback(error);
            }
        }
    }
    
    async clear(callback) {
        if (!this.tableClient) {
            return callback(new Error('Azure Table client not available'));
        }
        
        try {
            const entities = this.tableClient.listEntities({
                queryOptions: { filter: "PartitionKey eq 'session'" }
            });
            
            for await (const entity of entities) {
                await this.tableClient.deleteEntity('session', entity.rowKey);
            }
            callback();
        } catch (error) {
            console.error('❌ Error clearing sessions in Azure:', error.message);
            callback(error);
        }
    }
    
    async length(callback) {
        if (!this.tableClient) {
            return callback(new Error('Azure Table client not available'));
        }
        
        try {
            let count = 0;
            const entities = this.tableClient.listEntities({
                queryOptions: { filter: "PartitionKey eq 'session'" }
            });
            
            for await (const entity of entities) {
                count++;
            }
            callback(null, count);
        } catch (error) {
            console.error('❌ Error counting sessions in Azure:', error.message);
            callback(error);
        }
    }
}

// Configure session store
let sessionStore;
if (accountName && accountKey) {
    console.log('🔧 Configuring Azure Table Storage session store...');
    sessionStore = new AzureTableSessionStore({
        tableName: 'sessions',
        ttl: 7 * 24 * 60 * 60 * 1000 // 7 days
    });
    console.log('✅ Custom Azure Table Storage session store configured');
} else {
    console.log('⚠️  Azure credentials not available - using memory store');
    console.log('💡 Sessions will not persist across server restarts');
    console.log('💡 Make sure AZURE_STORAGE_ACCOUNT_NAME and AZURE_STORAGE_ACCOUNT_KEY are set in production');
}

app.use(session({
    store: sessionStore, // Use custom Azure Table Storage or fallback to memory
    secret: sessionSecret,
    name: 'villainarc.sid', // Custom session name
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production', // HTTPS only in production
        httpOnly: true, // Prevent XSS attacks
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days (longer for better UX)
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax', // Allow cross-site cookies in production
        domain: process.env.NODE_ENV === 'production' ? undefined : undefined // Let browser handle domain
    }
}));

// Initialize Passport
app.use(passport.initialize());
app.use(passport.session());

// Setup Discord OAuth2 authentication
const discordAuthEnabled = setupDiscordAuth(app);

app.use(morgan('combined'));
// Remove JSON/URLencoded limits for file uploads - multer handles the file size limit
app.use(express.json({ limit: '1mb' })); // Keep small for non-file requests
app.use(express.urlencoded({ extended: true, limit: '1mb' })); // Keep small for non-file requests

// Add detailed request logging for debugging
app.use((req, res, next) => {
    console.log(`🌐 ${req.method} ${req.path} - Origin: ${req.get('origin')} - IP: ${req.ip}`);
    
    // Debug session info for API calls
    if (req.path.startsWith('/api/')) {
        console.log(`🔍 API Request: ${req.path}`);
        console.log(`Session ID: ${req.sessionID}`);
        console.log(`User in session: ${req.user ? `${req.user.username}#${req.user.discriminator}` : 'None'}`);
        console.log(`Cookies: ${JSON.stringify(req.cookies)}`);
    }
    
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

// Enhanced file filter - allow MKV but warn about browser compatibility
const fileFilter = (req, file, cb) => {
    const allowedTypes = [
        'video/mp4', 'video/webm', 'video/ogg', 'video/quicktime', 
        'video/x-msvideo', 'video/x-flv', 'video/x-ms-wmv', 'video/x-matroska'
    ];
    const allowedExtensions = ['.mp4', '.webm', '.ogg', '.mov', '.avi', '.flv', '.wmv', '.mkv'];
    
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
        cb(new Error('Only video files are allowed! Supported formats: MP4, WebM, OGG, MOV, AVI, FLV, WMV, MKV. Detected type: ' + file.mimetype), false);
    }
};

const upload = multer({ 
    storage,
    fileFilter,
    limits: {
        fileSize: 500 * 1024 * 1024 // 500MB - Updated limit
    }
});

// In-memory store for video metadata (in production, use a database)
const videoStore = new Map();

// Helper function for formatting file sizes
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

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

// Add this function to set the Azure Storage service version for video streaming
async function setAzureStorageVersion() {
    if (!blobServiceClient) {
        console.log('⚠️  Azure not configured - skipping version setup');
        return;
    }
    
    try {
        console.log('🔧 Setting Azure Storage service version for video streaming...');
        
        const serviceProperties = {
            defaultServiceVersion: '2021-08-06' // Use a recent version that supports range requests
        };
        
        // Try to set service properties (version only, CORS is handled separately)
        if (typeof blobServiceClient.setProperties === 'function') {
            await blobServiceClient.setProperties(serviceProperties);
            console.log('✅ Azure Storage service version set to 2021-08-06');
        } else {
            console.log('⚠️  setProperties method not available - using default service version');
        }        
    } catch (error) {
        console.error('❌ Error setting Azure service version:', error.message);
        // Don't fail the startup, just log the issue
    }
}

// Set Azure container to public access like Cloudinary
async function setContainerPublicAccess() {
    if (!blobServiceClient) {
        console.log('⚠️  Azure not configured - skipping public access setup');
        return;
    }
    
    try {
        console.log('🔧 Setting Azure container to public access...');
        
        const containerClient = blobServiceClient.getContainerClient(containerName);
        
        // Check if container exists, create if not
        const containerExists = await containerClient.exists();
        if (!containerExists) {
            await containerClient.create({
                access: 'blob' // Public read access for blobs
            });
            console.log(`✅ Container '${containerName}' created with public access`);
        } else {
            // Set existing container to public access
            await containerClient.setAccessPolicy('blob');
            console.log(`✅ Container '${containerName}' set to public access`);
        }
        
    } catch (error) {
        console.error('❌ Failed to set container public access:', error.message);
        console.log('💡 You may need to set this manually in Azure Portal:');
        console.log('   1. Go to Azure Portal -> Your Storage Account');
        console.log('   2. Navigate to Containers -> Select your container');
        console.log('   3. Change "Public access level" to "Blob (anonymous read access for blobs only)"');
    }
}

// Debugging endpoint to list all videos in the store
app.get('/api/debug/videos', (req, res) => {
    try {
        const allVideos = Array.from(videoStore.values());
        
        res.json({
            success: true,
            videos: allVideos
        });
    } catch (error) {
        console.error('Error fetching video list:', error);
        res.status(500).json({ error: 'Failed to fetch video list' });
    }
});

// Routes - Secure upload endpoint (requires Discord authentication)
app.post('/upload', uploadLimit, requireAuth, checkUploadQuota, upload.single('video'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No video file uploaded' });
        }

        // Generate cryptographically secure video ID
        const videoId = crypto.randomBytes(16).toString('hex');
          console.log(`📤 Processing upload: ${req.file.originalname} (${req.file.size} bytes)`);
        
        if (!blobServiceClient) {
            throw new Error('Azure Blob Storage not configured');
        }
        
        // Use original file data - no conversion needed
        const fileBuffer = req.file.buffer;
        const fileName = req.file.originalname;
        const contentType = req.file.mimetype;
        const fileSize = req.file.size;
        const fileExtension = path.extname(req.file.originalname).toLowerCase();
        
        // Check if it's an MKV file (for informational purposes)
        const isMKV = fileExtension === '.mkv' || contentType === 'video/x-matroska';
        
        if (isMKV) {
            console.log('ℹ️ MKV file detected - uploading as-is (may have limited browser compatibility)');
        }
        
        // Generate blob name with original extension
        const blobName = `${videoId}${fileExtension}`;
        
        console.log(`📤 Uploading to Azure Blob: ${fileName} (${fileSize} bytes)`);
        
        // Get container client
        const containerClient = blobServiceClient.getContainerClient(containerName);
        const blockBlobClient = containerClient.getBlockBlobClient(blobName);
        
        // Upload with proper content type and comprehensive metadata
        const uploadResult = await blockBlobClient.upload(
            fileBuffer, 
            fileSize,
            {
                blobHTTPHeaders: {
                    blobContentType: contentType,
                    blobContentDisposition: `inline; filename="${fileName}"`,
                    blobCacheControl: 'public, max-age=31536000'
                },                metadata: {
                    videoId: videoId,
                    originalName: req.file.originalname,
                    uploadedBy: req.user.id,
                    uploaderUsername: req.user.username,
                    uploaderDiscriminator: req.user.discriminator || '0',
                    uploaderAvatar: req.user.avatar || '',
                    uploadDate: new Date().toISOString(),
                    contentType: contentType,
                    size: fileSize.toString(),
                    downloadCount: '0',
                    uploaderIp: req.ip,
                    fileFormat: fileExtension,
                    isMKV: isMKV ? 'true' : 'false'
                }
            }
        );
        
        console.log('✅ Azure Blob upload successful:', blobName);
          const videoData = {
            id: videoId,
            originalName: fileName,
            blobUrl: blockBlobClient.url,
            blobName: blobName,
            containerName: containerName,
            size: fileSize,
            contentType: contentType,
            uploadDate: new Date(),
            downloadCount: 0,
            ip: req.ip,
            uploadedBy: req.user.id,
            uploaderUsername: req.user.username,
            uploaderAvatar: req.user.avatar,
            fileFormat: fileExtension,
            isMKV: isMKV
        };

        videoStore.set(videoId, videoData);const baseUrl = process.env.NODE_ENV === 'production' 
            ? process.env.BACKEND_URL || `${req.protocol}://${req.get('host')}`
            : `${req.protocol}://${req.get('host')}`;
              const shareLink = `${baseUrl}/v/${videoId}`;
        const downloadLink = `${baseUrl}/download/${videoId}`;
        const previewUrl = videoData.blobUrl; // Use direct Azure URL like Cloudinary// Send Discord webhook (if URL is properly configured)
        if (DISCORD_WEBHOOK_URL && DISCORD_WEBHOOK_URL.startsWith('https://discord.com/api/webhooks/')) {
            try {
                await sendDiscordWebhook(shareLink, videoData);
            } catch (webhookError) {
                console.error('Discord webhook failed:', webhookError.message);
                // Don't fail upload if webhook fails
            }
        }

        // Record upload for user quota tracking
        const uploadRecord = {
            ...videoData,
            shareLink,
            downloadLink,
            previewUrl
        };
        recordUpload(req.user.id, uploadRecord);        res.json({
            success: true,
            id: videoId,
            shareLink,
            downloadUrl: downloadLink,
            previewUrl,
            filename: videoData.originalName,
            size: videoData.size,
            contentType: videoData.contentType,
            fileFormat: videoData.fileFormat,
            warning: isMKV ? 'MKV files may have limited browser compatibility. Consider converting to MP4 for best results.' : undefined,
            user: {
                username: req.user.username,
                quotaUsed: req.userQuota.used + req.file.size,
                quotaRemaining: req.userQuota.remaining - req.file.size
            }
        });} catch (error) {
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

// Clips API endpoints for the ClipsPage
app.get('/api/clips', requireAuth, (req, res) => {
    try {
        // Get all videos
        const allClips = [];
        
        for (const [videoId, videoData] of videoStore.entries()) {
            const baseUrl = process.env.NODE_ENV === 'production' 
                ? process.env.BACKEND_URL || `${req.protocol}://${req.get('host')}`
                : `${req.protocol}://${req.get('host')}`;
              // Get uploader info from stored user data or video metadata
            const { userStore } = require('./auth');
            const storedUser = userStore.get(videoData.uploadedBy);            const uploader = {
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
});

app.get('/api/clips/all', requireAuth, (req, res) => {
    try {
        // Get all videos and group by uploader
        const allClips = [];
          for (const [videoId, videoData] of videoStore.entries()) {            const baseUrl = process.env.NODE_ENV === 'production' 
                ? process.env.BACKEND_URL || `${req.protocol}://${req.get('host')}`
                : `${req.protocol}://${req.get('host')}`;
              // Get uploader info from stored user data or video metadata
            const { userStore } = require('./auth');
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
});

// OPTIONS handler for CORS preflight requests
app.options('/stream/:videoId', (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Range, Accept-Encoding, Accept-Ranges, Content-Type');
    res.setHeader('Access-Control-Max-Age', '86400'); // 24 hours
    res.status(200).end();
});

// Video proxy server - download from Azure and stream to client
// HEAD handler for video streaming - required for browser video players
app.head('/stream/:videoId', async (req, res) => {
    const { videoId } = req.params;
    const videoData = videoStore.get(videoId);

    if (!videoData) {
        return res.status(404).end();
    }

    try {
        if (!blobServiceClient) {
            return res.status(500).end();
        }

        const containerClient = blobServiceClient.getContainerClient(videoData.containerName);
        const blockBlobClient = containerClient.getBlockBlobClient(videoData.blobName);

        // Get blob properties for accurate size
        const properties = await blockBlobClient.getProperties();
        const fileSize = properties.contentLength || videoData.size;        // Set all required headers for video streaming
        // Force MP4 content type for MKV files to improve browser compatibility
        const contentType = videoData.fileFormat === '.mkv' || videoData.isMKV ? 'video/mp4' : videoData.contentType;
        res.setHeader('Content-Type', contentType);
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Content-Length', fileSize);
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
});

app.get('/stream/:videoId', async (req, res) => {
    const { videoId } = req.params;
    const videoData = videoStore.get(videoId);

    if (!videoData) {
        return res.status(404).json({ error: 'Video not found' });
    }

    try {
        if (!blobServiceClient) {
            return res.status(500).json({ error: 'Azure Blob Storage not configured' });
        }

        console.log(`🔗 Generating SAS URL for: ${videoData.originalName}`);

        const containerClient = blobServiceClient.getContainerClient(videoData.containerName);
        const blockBlobClient = containerClient.getBlockBlobClient(videoData.blobName);

        // Check if blob exists
        const exists = await blockBlobClient.exists();
        if (!exists) {
            console.error(`❌ Blob not found: ${videoData.blobName}`);
            return res.status(404).json({ error: 'Video file not found in storage' });
        }        // Generate a temporary SAS URL that expires in 1 hour (like Cloudinary's approach)
        const sasOptions = {
            containerName: videoData.containerName,
            blobName: videoData.blobName,
            permissions: BlobSASPermissions.parse('r'), // read permission only
            startsOn: new Date(),
            expiresOn: new Date(new Date().valueOf() + 60 * 60 * 1000), // 1 hour from now
        };

        const sasToken = generateBlobSASQueryParameters(sasOptions, sharedKeyCredential).toString();

        const sasUrl = `${blockBlobClient.url}?${sasToken}`;
        
        // Redirect to the direct SAS URL (browser will handle video streaming natively)
        res.redirect(302, sasUrl);

    } catch (error) {
        console.error('❌ SAS URL generation error:', error);
        res.status(500).json({ 
            error: 'Video streaming failed',
            details: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
});

// Configure Azure Blob Storage CORS with multiple fallback approaches
async function configureAzureCORS() {
    if (!blobServiceClient) {
        console.log('⚠️  Azure Blob Storage not configured - skipping CORS setup');
        return;
    }
    
    try {
        console.log('🔧 Configuring Azure Blob Storage CORS...');        const corsRule = {
            allowedOrigins: ['*'], // Use array format for consistency
            allowedMethods: ['GET', 'HEAD', 'OPTIONS'],
            allowedHeaders: ['*'],
            exposedHeaders: ['Content-Range', 'Accept-Ranges', 'Content-Length', 'Content-Type'],
            maxAgeInSeconds: 86400
        };
        
        const blobServiceProperties = {
            cors: [corsRule],
            deleteRetentionPolicy: {
                enabled: false
            }
        };
        
        // Try different method names for Azure SDK compatibility
        let success = false;
        const methods = ['setProperties', 'setBlobServiceProperties', 'setServiceProperties'];
        
        for (const methodName of methods) {
            if (typeof blobServiceClient[methodName] === 'function') {
                try {
                    await blobServiceClient[methodName](blobServiceProperties);
                    console.log(`✅ Azure Blob Storage CORS configured successfully using ${methodName}`);
                    success = true;
                    break;
                } catch (methodError) {
                    console.log(`❌ Method ${methodName} failed:`, methodError.message);
                    continue;
                }
            }
        }
        
        if (!success) {
            throw new Error('No working CORS configuration method found');
        }
        
    } catch (error) {
        console.error('❌ Failed to configure Azure CORS:', error.message);
        
        // Check if it's a permission issue
        if (error.code === 'AuthorizationPermissionMismatch' || error.statusCode === 403) {
            console.log('⚠️  Insufficient permissions to configure CORS automatically');
            console.log('💡 Please configure CORS manually in Azure Portal:');
            console.log('   1. Go to Azure Portal -> Your Storage Account');
            console.log('   2. Navigate to Settings -> Resource sharing (CORS)');
            console.log('   3. Add CORS rules for Blob service');
        } else if (error.code === 'InvalidOperation' || error.message.includes('not a function')) {
            console.log('⚠️  Azure SDK method not available - using fallback approach');
            console.log('💡 Manual CORS configuration required in Azure Portal');
        } else {
            console.log('⚠️  Video streaming may not work properly without CORS configuration');
            console.log('💡 You may need to configure CORS manually in Azure Portal');
        }
        
        // Provide detailed manual CORS configuration instructions
        console.log('\n📋 Manual CORS Configuration Steps:');
        console.log('1. Open Azure Portal (portal.azure.com)');
        console.log('2. Navigate to your Storage Account');
        console.log('3. Go to Settings -> Resource sharing (CORS)');
        console.log('4. Click on "Blob service" tab');
        console.log('5. Add a new CORS rule with these settings:');
        console.log('   - Allowed origins: * (or your specific domains)');
        console.log('   - Allowed methods: GET,HEAD,OPTIONS,PUT,POST');
        console.log('   - Allowed headers: *');
        console.log('   - Exposed headers: Content-Range,Accept-Ranges,Content-Length,Content-Type,Content-Disposition');
        console.log('   - Max age: 86400');
        console.log('6. Click "Save" to apply the configuration');
    }
}

// Initialize Azure configuration for video streaming like Cloudinary
if (blobServiceClient) {
    setContainerPublicAccess();
    setAzureStorageVersion();
    configureAzureCORS();
    // Rebuild video store from Azure metadata on startup
    rebuildVideoStore();
}

// Helper function to format file sizes
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

app.get('/v/:videoId', (req, res) => {
    const { videoId } = req.params;
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
                    * { margin: 0; padding: 0; box-sizing: border-box; }                    body { 
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
                    .error { color: #ff6b6b; font-size: 2rem; margin-bottom: 1rem; }                    .back-link { 
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
    }    const baseUrl = process.env.NODE_ENV === 'production' 
        ? process.env.BACKEND_URL || `${req.protocol}://${req.get('host')}`
        : `${req.protocol}://${req.get('host')}`;    const videoUrl = `${baseUrl}/stream/${videoId}`; // Use proxy stream like Cloudinary
    const downloadUrl = `${baseUrl}/download/${videoId}`;
    
    // Get uploader info and avatar URL
    const { userStore } = require('./auth');
    const storedUser = userStore.get(videoData.uploadedBy);
    const uploaderUser = storedUser || {
        id: videoData.uploadedBy,
        username: videoData.uploaderUsername,
        avatar: videoData.uploaderAvatar,
        discriminator: '0'
    };
    const avatarUrl = getDiscordAvatarUrl(uploaderUser);res.send(`
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
        </head>        <body>
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
                <div class="video-container">                    <h1 class="video-title">${videoData.originalName}</h1>                    <div class="video-wrapper" style="position: relative;">
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
                        </video>                        <div id="loadingStatus" style="display: none; position: absolute; top: 10px; right: 10px; background: rgba(0,0,0,0.8); color: white; padding: 0.5rem; border-radius: 4px; font-size: 0.8rem;">
                            Loading...
                        </div>
                    </div>
                </div>
                
                <div class="info-grid">
                    <div class="info-card">
                        <div class="card-title">Uploaded by</div>                        <div class="uploader-info">                            <div class="uploader-avatar">
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
            </div>            <script>                // Simple video loading with MKV support
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
                        console.log('📋 Response headers:', Array.from(response.headers.entries()));                        if (!response.ok) {
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
});

app.get('/download/:videoId', async (req, res) => {
    const { videoId } = req.params;
    const videoData = videoStore.get(videoId);

    if (!videoData) {
        return res.status(404).json({ error: 'Video not found' });
    }

    try {
        // Increment download count
        videoData.downloadCount++;
        videoStore.set(videoId, videoData);

        // Get the blob client
        const containerClient = blobServiceClient.getContainerClient(videoData.containerName);
        const blockBlobClient = containerClient.getBlockBlobClient(videoData.blobName);
        
        // Download the blob as a stream
        const downloadResponse = await blockBlobClient.download();
        
        // Set proper headers for download
        res.setHeader('Content-Type', videoData.contentType);
        res.setHeader('Content-Length', videoData.size);
        res.setHeader('Content-Disposition', `attachment; filename="${videoData.originalName}"`);
        
        // Pipe the stream to response
        downloadResponse.readableStreamBody.pipe(res);
        
    } catch (error) {
        console.error('Error downloading video:', error);
        res.status(500).json({ error: 'Failed to download video' });
    }
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

// Session status endpoint (for debugging)
app.get('/session-status', requireAuth, (req, res) => {
    res.json({
        sessionId: req.sessionID,
        user: req.user ? {
            id: req.user.id,
            username: req.user.username,
            discriminator: req.user.discriminator
        } : null,
        sessionStore: sessionStore ? 'Azure Table Storage' : 'Memory Store',
        authenticated: !!req.user,
        sessionAge: req.session.cookie.maxAge,
        expires: new Date(Date.now() + req.session.cookie.maxAge).toISOString()
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
            },            body: JSON.stringify({
                embeds: [{
                    title: '🎬 VillainArc Clip Uploaded',
                    description: `**${videoData.originalName.substring(0, 100)}**${videoData.originalName.length > 100 ? '...' : ''}\n\n[🔗 View Clip](${shareLink})`,
                    color: 0x7f00ff, // VillainArc purple
                    fields: [
                        {
                            name: '👤 Uploaded by',
                            value: videoData.uploaderUsername || 'Unknown User',
                            inline: true
                        },
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

// Add Azure CORS configuration check endpoint
app.get('/azure-cors-status', requireAuth, async (req, res) => {
    if (!blobServiceClient) {
        return res.json({
            configured: false,
            message: 'Azure Blob Storage not configured',
            instructions: 'Please set AZURE_STORAGE_ACCOUNT_NAME and AZURE_STORAGE_ACCOUNT_KEY environment variables'
        });
    }
    
    try {
        const properties = await blobServiceClient.getProperties();
        const corsConfigured = properties.cors && properties.cors.length > 0;
        
        res.json({
            configured: corsConfigured,
            message: corsConfigured ? 'CORS is configured' : 'CORS needs manual configuration',
            instructions: corsConfigured ? null : {
                steps: [
                    '1. Go to Azure Portal -> Your Storage Account',
                    '2. Navigate to Settings -> Resource sharing (CORS)',
                    '3. Add these CORS rules for Blob service:',
                    '   - Allowed origins: * (or your specific domains)',
                    '   - Allowed methods: GET,HEAD,OPTIONS,PUT,POST',
                    '   - Allowed headers: *',
                    '   - Exposed headers: Content-Range,Accept-Ranges,Content-Length,Content-Type',
                    '   - Max age: 86400',
                    '4. Save the configuration'
                ]
            },
            currentCors: properties.cors || []
        });
    } catch (error) {
        res.json({
            configured: false,
            message: 'Failed to check CORS configuration',
            error: error.message
        });
    }
});

// Debug endpoint to test Azure connectivity and list videos
app.get('/debug/azure-test', requireAuth, async (req, res) => {
    try {
        if (!blobServiceClient) {
            return res.json({
                status: 'error',
                message: 'Azure Blob Storage not configured',
                configured: false,
                accountName: accountName ? 'Set' : 'Missing',
                accountKey: accountKey ? 'Set' : 'Missing',
                containerName: containerName
            });
        }

        const containerClient = blobServiceClient.getContainerClient(containerName);
        
        // Test container existence
        const containerExists = await containerClient.exists();
        
        if (!containerExists) {
            return res.json({
                status: 'error',
                message: 'Container does not exist',
                containerName: containerName,
                configured: true,
                containerExists: false
            });
        }

        // List blobs in container (first 10)
        const blobs = [];
        let count = 0;
        for await (const blob of containerClient.listBlobsFlat()) {
            if (count >= 10) break;
            blobs.push({
                name: blob.name,
                size: blob.properties.contentLength,
                contentType: blob.properties.contentType,
                lastModified: blob.properties.lastModified
            });
            count++;
        }

        // Test CORS by trying to get container properties
        let corsEnabled = false;
        try {
            const serviceProperties = await blobServiceClient.getProperties();
            corsEnabled = serviceProperties.cors && serviceProperties.cors.length > 0;
        } catch (corsError) {
            console.log('Could not check CORS properties:', corsError.message);
        }

        res.json({
            status: 'success',
            message: 'Azure Blob Storage connection successful',
            configured: true,
            containerExists: true,
            containerName: containerName,
            accountName: accountName,
            blobCount: count,
            blobs: blobs,
            corsEnabled: corsEnabled,
            videoStoreCount: videoStore.size,
            testPerformed: new Date().toISOString()
        });

    } catch (error) {
        console.error('Azure test error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Azure test failed',
            error: error.message,
            code: error.code,
            statusCode: error.statusCode
        });
    }
});

// Debug endpoint to test individual video streaming
app.get('/debug/video-test/:videoId', requireAuth, async (req, res) => {
    const { videoId } = req.params;
    const videoData = videoStore.get(videoId);

    if (!videoData) {
        return res.json({
            status: 'error',
            message: 'Video not found',
            videoId: videoId,
            availableVideos: Array.from(videoStore.keys()).slice(0, 10)
        });
    }

    try {
        if (!blobServiceClient) {
            return res.json({
                status: 'error',
                message: 'Azure Blob Storage not configured',
                videoData: videoData
            });
        }

        const containerClient = blobServiceClient.getContainerClient(videoData.containerName);
        const blockBlobClient = containerClient.getBlockBlobClient(videoData.blobName);
        
        // Test blob existence
        const exists = await blockBlobClient.exists();
        
        if (!exists) {
            return res.json({
                status: 'error',
                message: 'Blob not found in Azure',
                blobName: videoData.blobName,
                containerName: videoData.containerName,
                blobUrl: videoData.blobUrl
            });
        }

        // Get blob properties
        const properties = await blockBlobClient.getProperties();
        
        // Test download (first 1KB only)
        let downloadTest = 'failed';
        let downloadError = null;
        try {
            const downloadResponse = await blockBlobClient.download(0, 1024);
            if (downloadResponse.readableStreamBody) {
                downloadTest = 'success';
            }
        } catch (dlError) {
            downloadError = dlError.message;
        }

        res.json({
            status: 'success',
            message: 'Video test completed',
            videoId: videoId,
            videoData: {
                originalName: videoData.originalName,
                size: videoData.size,
                contentType: videoData.contentType,
                blobName: videoData.blobName,
                containerName: videoData.containerName
            },
            blobExists: exists,
            blobProperties: {
                contentLength: properties.contentLength,
                contentType: properties.contentType,
                lastModified: properties.lastModified,
                etag: properties.etag
            },
            downloadTest: downloadTest,
            downloadError: downloadError,
            streamUrl: `${req.protocol}://${req.get('host')}/stream/${videoId}`,
            testPerformed: new Date().toISOString()
        });

    } catch (error) {
        console.error('Video test error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Video test failed',
            videoId: videoId,
            error: error.message,
            code: error.code,
            statusCode: error.statusCode,
            videoData: videoData
        });
    }
});

// Debug endpoint to check Azure SDK methods
app.get('/debug/azure-sdk', requireAuth, (req, res) => {
    if (!blobServiceClient) {
        return res.json({
            status: 'error',
            message: 'Azure Blob Storage not configured'
        });
    }
    
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(blobServiceClient))
        .filter(method => typeof blobServiceClient[method] === 'function')
        .sort();
    
    res.json({
        status: 'success',
        message: 'Azure SDK methods available',
        availableMethods: methods,
        serviceUrl: blobServiceClient.url,
        accountName: blobServiceClient.accountName
    });
});

// Debug endpoint to test video streaming capabilities (development only)
app.get('/debug/test-streaming/:videoId', async (req, res) => {
    const { videoId } = req.params;
    const videoData = videoStore.get(videoId);
    
    if (!videoData) {
        return res.json({ error: 'Video not found' });
    }
    
    try {
        const containerClient = blobServiceClient.getContainerClient(videoData.containerName);
        const blockBlobClient = containerClient.getBlockBlobClient(videoData.blobName);
        
        // Get blob properties
        const properties = await blockBlobClient.getProperties();
        
        // Test range request capability
        const testRange = await blockBlobClient.download(0, 1024);
        
        res.json({
            success: true,
            videoId: videoId,
            blobName: videoData.blobName,
            originalContentType: videoData.contentType,
            actualContentType: properties.contentType,
            fileSize: properties.contentLength,
            supportsRanges: !!testRange.acceptRanges,
            streamUrl: `${req.protocol}://${req.get('host')}/stream/${videoId}`,
            testPerformed: new Date().toISOString()
        });
        
    } catch (error) {
        res.json({
            success: false,
            error: error.message,
            videoId: videoId
        });
    }
});

// Debug endpoint to test video streaming directly
app.get('/debug/stream-test/:videoId', async (req, res) => {
    const { videoId } = req.params;
    const videoData = videoStore.get(videoId);
    
    if (!videoData) {
        return res.json({ error: 'Video not found' });
    }
    
    try {
        const containerClient = blobServiceClient.getContainerClient(videoData.containerName);
        const blockBlobClient = containerClient.getBlockBlobClient(videoData.blobName);
        
        // Test blob accessibility
        const exists = await blockBlobClient.exists();
        const properties = exists ? await blockBlobClient.getProperties() : null;
        
        // Test range request
        let rangeTest = null;
        try {
            const testRange = await blockBlobClient.download(0, 1024);
            rangeTest = {
                success: true,
                hasStream: !!testRange.readableStreamBody,
                contentType: testRange.contentType,
                acceptRanges: testRange.acceptRanges
            };
        } catch (rangeError) {
            rangeTest = {
                success: false,
                error: rangeError.message
            };
        }
        
        res.json({
            success: true,
            videoId: videoId,
            blobName: videoData.blobName,
            containerName: videoData.containerName,
            blobExists: exists,
            blobSize: properties?.contentLength || videoData.size,
            blobContentType: properties?.contentType || videoData.contentType,
            streamUrl: `${req.protocol}://${req.get('host')}/stream/${videoId}`,
            directBlobUrl: videoData.blobUrl,
            rangeTest: rangeTest,
            testTime: new Date().toISOString()
        });
        
    } catch (error) {
        res.json({
            success: false,
            error: error.message,
            videoId: videoId
        });
    }
});

// Function to rebuild video store from Azure metadata on startup
async function rebuildVideoStore() {
    if (!blobServiceClient) {
        console.log('⚠️  Azure not configured - skipping video store rebuild');
        return;
    }
    
    try {
        console.log('🔄 Rebuilding video store from Azure metadata...');
        
        const containerClient = blobServiceClient.getContainerClient(containerName);
        
        // Check if container exists
        const containerExists = await containerClient.exists();
        if (!containerExists) {
            console.log(`⚠️  Container '${containerName}' does not exist - creating it...`);
            await containerClient.create();
            console.log(`✅ Container '${containerName}' created`);
            return;
        }
        
        let rebuiltCount = 0;
        
        // Iterate through all blobs and rebuild video store
        for await (const blob of containerClient.listBlobsFlat({ includeMetadata: true })) {
            try {
                // Extract video ID from blob name (remove extension)
                const videoId = path.basename(blob.name, path.extname(blob.name));
                
                // Get metadata from blob
                const metadata = blob.metadata || {};
                
                // Reconstruct video data from blob properties and metadata
                const videoData = {
                    id: metadata.videoId || videoId,
                    originalName: metadata.originalName || blob.name,
                    blobUrl: `https://${accountName}.blob.core.windows.net/${containerName}/${blob.name}`,
                    blobName: blob.name,
                    containerName: containerName,
                    size: blob.properties.contentLength || parseInt(metadata.size || '0'),
                    contentType: blob.properties.contentType || metadata.contentType || 'video/mp4',
                    uploadDate: blob.properties.lastModified || new Date(metadata.uploadDate || Date.now()),
                    downloadCount: parseInt(metadata.downloadCount || '0'),
                    ip: metadata.uploaderIp || 'unknown',
                    uploadedBy: metadata.uploadedBy || 'unknown',
                    uploaderUsername: metadata.uploaderUsername || 'Unknown User',
                    uploaderAvatar: metadata.uploaderAvatar || null
                };
                
                // Store in memory
                videoStore.set(videoId, videoData);
                rebuiltCount++;
                
            } catch (blobError) {
                console.error(`Failed to rebuild video data for blob ${blob.name}:`, blobError.message);
            }
        }
        
        console.log(`✅ Video store rebuilt with ${rebuiltCount} videos from Azure metadata`);
        
    } catch (error) {
        console.error('❌ Failed to rebuild video store:', error.message);
    }
}

// Rebuild video store on startup
rebuildVideoStore();

// Debug endpoint to get SAS URL as JSON
app.get('/debug/sas/:videoId', async (req, res) => {
    const { videoId } = req.params;
    const videoData = videoStore.get(videoId);

    if (!videoData) {
        return res.status(404).json({ error: 'Video not found' });
    }

    try {
        if (!blobServiceClient) {
            return res.status(500).json({ error: 'Azure Blob Storage not configured' });
        }

        const containerClient = blobServiceClient.getContainerClient(videoData.containerName);
        const blockBlobClient = containerClient.getBlockBlobClient(videoData.blobName);

        // Generate SAS URL
        const sasOptions = {
            containerName: videoData.containerName,
            blobName: videoData.blobName,
            permissions: BlobSASPermissions.parse('r'),
            startsOn: new Date(),
            expiresOn: new Date(new Date().valueOf() + 60 * 60 * 1000),
        };        const sasToken = generateBlobSASQueryParameters(sasOptions, sharedKeyCredential).toString();

        const sasUrl = `${blockBlobClient.url}?${sasToken}`;
        
        res.json({
            videoId,
            originalName: videoData.originalName,
            sasUrl,
            expiresIn: '1 hour',
            message: 'Use this URL directly in a video tag'
        });

    } catch (error) {
        console.error('❌ SAS URL debug error:', error);
        res.status(500).json({ 
            error: 'Failed to generate SAS URL',
            details: error.message
        });
    }
});
