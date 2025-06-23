// Compatibility auth.js file for the refactored structure
// This ensures the old server.js can still import the required functions

const { setupDiscordAuth, userStore } = require('./src/services/authService');
const { requireAuth, requireGuildMembership, checkUploadQuota, recordUpload } = require('./src/middleware/auth');

module.exports = {
    setupDiscordAuth,
    requireAuth,
    requireGuildMembership,
    checkUploadQuota,
    recordUpload,
    userStore
};
