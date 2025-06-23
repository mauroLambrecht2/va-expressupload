const express = require('express');
const path = require('path');
const session = require('express-session');
const helmet = require('helmet');
const morgan = require('morgan');
const cors = require('cors');

// Import configuration and services
const config = require('./config');
const { initializeAzureStorage } = require('./config/azure');
const { setupDiscordAuth } = require('./services/authService');
const { initializeAzureConfiguration } = require('./services/azureStorageService');

// Import middleware
const { apiLimit } = require('./middleware/rateLimiter');
const errorHandler = require('./middleware/errorHandler');

// Import routes
const routes = require('./routes');

const app = express();

// Initialize Azure Storage
const azureStorage = initializeAzureStorage();

// Initialize Azure configuration asynchronously (don't block startup)
if (azureStorage) {
    initializeAzureConfiguration().catch(error => {
        console.error('⚠️  Failed to initialize Azure configuration:', error.message);
        console.log('🔧 Server will continue running, but Azure features may be limited');
    });
}

// Security middleware
app.use(helmet({
    contentSecurityPolicy: false, // Disable for development
    crossOriginEmbedderPolicy: false
}));

// CORS configuration
const corsOptions = {
    origin: function (origin, callback) {
        // Allow requests from development ports and production URLs
        const allowedOrigins = config.server.nodeEnv === 'production' 
            ? [config.server.backendUrl, config.server.frontendUrl].filter(Boolean)
            : ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:8000'];
        
        // Allow requests with no origin (mobile apps, curl, etc.)
        if (!origin) return callback(null, true);
        
        if (allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            console.log('CORS blocked origin:', origin);
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true, // This is crucial for session cookies
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'HEAD'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Range', 'Accept-Encoding', 'X-Requested-With'],
    exposedHeaders: ['Content-Range', 'Accept-Ranges', 'Content-Length', 'Content-Type']
};

app.use(cors(corsOptions));

// Logging
if (config.server.nodeEnv !== 'production') {
    app.use(morgan('combined'));
}

// Body parsing middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Session configuration
app.use(session({
    secret: config.server.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: config.server.nodeEnv === 'production', // HTTPS in production, HTTP in dev
        httpOnly: true,
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
        sameSite: config.server.nodeEnv === 'production' ? 'none' : 'lax', // 'none' for cross-origin in production
        domain: config.server.nodeEnv === 'production' ? undefined : undefined // Let browser handle domain
    },
    name: 'va.session' // Custom session name
}));

// Setup Discord authentication
const authConfigured = setupDiscordAuth(app);

// Trust proxy for accurate IP addresses
if (config.server.nodeEnv === 'production') {
    app.set('trust proxy', 1);
}

// Request logging middleware
app.use((req, res, next) => {
    const userInfo = req.user ? `${req.user.username}#${req.user.discriminator}` : 'Anonymous';
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path} - User: ${userInfo} - IP: ${req.ip}`);
    next();
});

// Health check endpoint for Render
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: config.server.nodeEnv,
        azureConfigured: !!azureStorage
    });
});

// Root endpoint
app.get('/', (req, res) => {
    res.json({
        message: 'VillainArc Video Sharing API',
        version: '2.0.0',
        environment: config.server.nodeEnv,
        authConfigured,
        azureConfigured: !!azureStorage
    });
});

// API rate limiting
app.use('/api', apiLimit);

// Mount all routes
app.use('/', routes);

// Error handling middleware (must be last)
app.use(errorHandler);

module.exports = app;
