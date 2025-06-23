require('dotenv').config();

const config = {    server: {
        port: process.env.PORT || 8000,
        nodeEnv: process.env.NODE_ENV || 'development',
        backendUrl: process.env.BACKEND_URL,
        frontendUrl: process.env.FRONTEND_URL || (process.env.NODE_ENV === 'production' ? process.env.BACKEND_URL : 'http://localhost:3000'),
        sessionSecret: process.env.SESSION_SECRET || 'your-secret-key-here'
    },
    discord: {
        clientId: process.env.DISCORD_CLIENT_ID,
        clientSecret: process.env.DISCORD_CLIENT_SECRET,
        redirectUri: process.env.DISCORD_REDIRECT_URI,
        webhookUrl: process.env.DISCORD_WEBHOOK_URL,
        guildId: '1105396951509389372',
        requiredRoles: ['1175503622197497896', '1288162863839580344', '1355299699770261827']
    },
    azure: {
        accountName: process.env.AZURE_STORAGE_ACCOUNT_NAME,
        accountKey: process.env.AZURE_STORAGE_ACCOUNT_KEY,
        containerName: process.env.AZURE_STORAGE_CONTAINER_NAME || 'videos'
    },
    upload: {
        maxFileSize: 1024 * 1024 * 1024, // 1GB
        maxFieldSize: 25 * 1024 * 1024, // 25MB
        userQuota: 5 * 1024 * 1024 * 1024 // 5GB per user
    },
    rateLimit: {
        upload: {
            windowMs: 15 * 60 * 1000, // 15 minutes
            max: process.env.NODE_ENV === 'production' ? 3 : 10
        },
        api: {
            windowMs: 1 * 60 * 1000, // 1 minute
            max: 100
        }
    }
};

module.exports = config;
