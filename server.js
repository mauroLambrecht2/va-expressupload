const app = require('./src/app');
const config = require('./src/config');

const PORT = config.server.port;

const server = app.listen(PORT, () => {
    console.log(`🚀 Video sharing server running on http://localhost:${PORT}`);
    console.log(`📁 Environment: ${config.server.nodeEnv}`);
    console.log(`🔗 Azure Storage: ${config.azure.accountName ? 'Configured' : 'Not configured'}`);
    console.log(`🔐 Discord Auth: ${config.discord.clientId ? 'Configured' : 'Not configured'}`);
    
    if (config.discord.webhookUrl) {
        console.log('🔗 Discord webhook configured');
    } else {
        console.log('⚠️  Discord webhook not configured (set DISCORD_WEBHOOK_URL environment variable)');
    }
});

// Set timeout for large uploads
server.timeout = 15 * 60 * 1000; // 15 minute timeout

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('👋 SIGTERM received, shutting down gracefully');
    server.close(() => {
        console.log('✅ Server closed');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('👋 SIGINT received, shutting down gracefully');
    server.close(() => {
        console.log('✅ Server closed');
        process.exit(0);
    });
});

module.exports = server;
