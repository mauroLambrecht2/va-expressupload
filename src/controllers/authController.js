const passport = require('passport');
const config = require('../config');
const { userStore } = require('../config/database');

// Get frontend URL based on environment
const getFrontendUrl = () => {
    return config.server.frontendUrl;
};

// Discord OAuth login
const login = (req, res, next) => {
    console.log('🔐 Initiating Discord OAuth login...');
    passport.authenticate('discord')(req, res, next);
};

// Discord OAuth callback
const callback = (req, res, next) => {
    passport.authenticate('discord', {
        failureRedirect: `${getFrontendUrl()}?auth=failed&error=oauth_failed`
    })(req, res, () => {
        if (req.user) {
            console.log(`✅ Discord OAuth success for user: ${req.user.username}#${req.user.discriminator}`);
            console.log(`🍪 Session ID: ${req.sessionID}`);
            console.log(`🔐 User authenticated: ${req.isAuthenticated()}`);
            
            // Force session save before redirect to ensure cookie is set
            req.session.save((err) => {
                if (err) {
                    console.error('Session save error:', err);
                    return res.redirect(`${getFrontendUrl()}?auth=failed&error=session_error`);
                }
                
                // Check guild membership status
                if (!req.user.guildMember) {
                    return res.redirect(`${getFrontendUrl()}?auth=failed&error=guild_access&reason=not_member`);
                }
                
                if (!req.user.hasRole) {
                    return res.redirect(`${getFrontendUrl()}?auth=failed&error=guild_access&reason=no_role`);
                }
                
                // Success - redirect to frontend
                res.redirect(`${getFrontendUrl()}?auth=success`);
            });
        } else {
            console.log('❌ Discord OAuth failed - no user data');
            res.redirect(`${getFrontendUrl()}?auth=failed&error=no_user`);
        }
    });
};

// Logout
const logout = (req, res) => {
    const username = req.user ? req.user.username : 'Unknown';
    req.logout((err) => {
        if (err) {
            console.error('Logout error:', err);
            return res.status(500).json({ error: 'Logout failed' });
        }
        console.log(`👋 User logged out: ${username}`);
        
        // Destroy the session completely
        req.session.destroy((destroyErr) => {
            if (destroyErr) {
                console.error('Session destroy error:', destroyErr);
            }
            // Clear the session cookie
            res.clearCookie('va.session');
            res.json({ success: true, message: 'Logged out successfully' });
        });
    });
};

// Get current user info
const getUserInfo = (req, res) => {
    if (!req.user || !req.isAuthenticated()) {
        return res.json({ authenticated: false });
    }

    // Get fresh user data from store to ensure we have latest upload stats
    const freshUserData = userStore.get(req.user.id);
    if (freshUserData) {
        // Update session with fresh data
        req.user = freshUserData;
    }

    res.json({
        authenticated: true,
        user: {
            id: req.user.id,
            username: req.user.username,
            discriminator: req.user.discriminator,
            avatar: req.user.avatar,
            verified: req.user.verified,
            loginTime: req.user.loginTime,
            guildMember: req.user.guildMember,
            hasRole: req.user.hasRole,
            totalUploadSize: req.user.totalUploadSize || 0,
            quota: req.user.quota || 5 * 1024 * 1024 * 1024, // 5GB
            uploads: req.user.uploads || []
        }
    });
};

// Login failed page
const loginFailed = (req, res) => {
    // Redirect to frontend with error parameter
    res.redirect(`${getFrontendUrl()}?error=auth_failed`);
};

// Test authentication endpoint
const testAuth = (req, res) => {
    res.json({
        timestamp: new Date().toISOString(),
        sessionID: req.sessionID,
        isAuthenticated: req.isAuthenticated(),
        hasUser: !!req.user,
        user: req.user ? {
            id: req.user.id,
            username: req.user.username,
            discriminator: req.user.discriminator,
            guildMember: req.user.guildMember,
            hasRole: req.user.hasRole
        } : null,
        sessionData: req.session,
        headers: {
            cookie: req.headers.cookie,
            userAgent: req.headers['user-agent'],
            origin: req.headers.origin
        }
    });
};

// Debug session info (development only)
const debugSession = (req, res) => {
    if (process.env.NODE_ENV === 'production') {
        return res.status(404).json({ error: 'Not found' });
    }
    
    res.json({
        sessionID: req.sessionID,
        session: req.session,
        user: req.user || null,
        authenticated: !!req.user,
        cookies: req.headers.cookie,
        isAuthenticated: req.isAuthenticated()
    });
};

// Refresh guild membership manually
const refreshGuildMembership = async (req, res) => {
    if (!req.user) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    
    try {
        // This would require storing the access token, which we don't do for security
        // For now, just return current status
        res.json({
            user: {
                id: req.user.id,
                username: req.user.username,
                guildMember: req.user.guildMember,
                hasRole: req.user.hasRole
            },
            message: 'Guild membership status refreshed on next login'
        });
    } catch (error) {
        console.error('Error refreshing guild membership:', error);
        res.status(500).json({ error: 'Failed to refresh guild membership' });
    }
};

// Get user uploads
const getUserUploads = (req, res) => {
    if (!req.user) {
        return res.status(401).json({ error: 'Authentication required' });
    }

    try {
        const { userUploads } = require('../config/database');
        const userQuota = userUploads.get(req.user.id) || { uploads: [] };
        
        res.json({
            uploads: userQuota.uploads || [],
            totalUploads: userQuota.uploads?.length || 0,
            totalSize: userQuota.used || 0,
            remainingQuota: userQuota.remaining || req.user.quota
        });
    } catch (error) {
        console.error('Error fetching user uploads:', error);
        res.status(500).json({ error: 'Failed to fetch uploads' });
    }
};

module.exports = {
    login,
    callback,
    logout,
    getUserInfo,
    loginFailed,
    testAuth,
    debugSession,
    refreshGuildMembership,
    getUserUploads
};
