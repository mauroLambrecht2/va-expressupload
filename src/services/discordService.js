const config = require('../config');

// Discord webhook function - Enhanced security
const sendDiscordWebhook = async (shareLink, videoData) => {
    const { webhookUrl } = config.discord;
    
    if (!webhookUrl || !webhookUrl.startsWith('https://discord.com/api/webhooks/')) {
        return;
    }

    try {
        const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
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
        throw error;
    }
};

module.exports = {
    sendDiscordWebhook
};
