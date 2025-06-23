const config = require('../config');
const https = require('https');

// Discord webhook function - Enhanced security with built-in Node.js modules
const sendDiscordWebhook = async (shareLink, videoData) => {
    const { webhookUrl } = config.discord;
    
    console.log('🔍 Discord webhook config check:', {
        hasWebhookUrl: !!webhookUrl,
        webhookUrlValid: webhookUrl?.startsWith('https://discord.com/api/webhooks/'),
        videoData: !!videoData,
        shareLink: !!shareLink
    });
    
    if (!webhookUrl || !webhookUrl.startsWith('https://discord.com/api/webhooks/')) {
        console.log('⚠️ Discord webhook not configured or invalid URL:', webhookUrl?.substring(0, 50) + '...');
        return;
    }

    console.log('📢 Sending Discord webhook notification for:', videoData.originalName);

    const webhookData = {
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
            timestamp: new Date(videoData.uploadDate).toISOString(),
            footer: {
                text: 'VillainArc Clip Sharing'
            }
        }]
    };

    try {
        // Use modern fetch if available, otherwise use https module
        if (typeof fetch !== 'undefined') {
            console.log('🔄 Using fetch for Discord webhook...');
            const response = await fetch(webhookUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(webhookData)
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            console.log('✅ Discord webhook sent successfully via fetch');
        } else {
            // Fallback to https module for older Node.js versions
            console.log('🔄 Using https module for Discord webhook...');
            await new Promise((resolve, reject) => {
                const url = new URL(webhookUrl);
                const postData = JSON.stringify(webhookData);
                
                const options = {
                    hostname: url.hostname,
                    port: url.port || 443,
                    path: url.pathname + url.search,
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(postData)
                    }
                };

                const req = https.request(options, (res) => {
                    console.log(`Discord webhook status: ${res.statusCode}`);
                    
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        console.log('✅ Discord webhook sent successfully via https');
                        resolve();
                    } else {
                        reject(new Error(`Discord webhook failed: ${res.statusCode} ${res.statusMessage}`));
                    }
                });

                req.on('error', (error) => {
                    console.error('❌ Discord webhook error:', error.message);
                    reject(error);
                });

                req.write(postData);
                req.end();
            });
        }
    } catch (error) {
        console.error('❌ Discord webhook error:', error.message);
        throw error;
    }
};

module.exports = {
    sendDiscordWebhook
};
