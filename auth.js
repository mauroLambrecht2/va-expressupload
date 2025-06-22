// Discord OAuth2 Authentication Module
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;

// User store - In production, use a database
const userStore = new Map();
const userUploads = new Map(); // Track uploads per user

const setupDiscordAuth = (app) => {
    // Check if Discord OAuth2 is configured
    const discordClientId = process.env.DISCORD_CLIENT_ID;
    const discordClientSecret = process.env.DISCORD_CLIENT_SECRET;
    const discordRedirectUri = process.env.DISCORD_REDIRECT_URI;

    if (!discordClientId || !discordClientSecret || !discordRedirectUri) {
        console.log('⚠️  Discord OAuth2 not configured - skipping authentication setup');
        return false;
    }

    console.log('🔐 Setting up Discord OAuth2 authentication...');    // VillainArc Guild and Role Configuration
    const VILLAINARC_GUILD_ID = '1105396951509389372';
    const REQUIRED_ROLES = ['1175503622197497896', '1288162863839580344', '1355299699770261827'];    // Passport setup
    passport.use(new DiscordStrategy({
        clientID: discordClientId,
        clientSecret: discordClientSecret,
        callbackURL: discordRedirectUri,
        scope: ['identify', 'guilds', 'guilds.members.read'] // Need guild access to check membership
    }, async (accessToken, refreshToken, profile, done) => {
        try {
            console.log(`🔍 Discord auth callback for user: ${profile.username}#${profile.discriminator} (${profile.id})`);
            
            // Check guild membership and roles
            const guildMember = await checkGuildMembership(accessToken, profile.id);
            console.log(`🏰 Guild membership check result:`, guildMember);
              // Create or update user
            const user = {
                id: profile.id,
                username: profile.username,
                discriminator: profile.discriminator,
                avatar: profile.avatar 
                    ? `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.png?size=128`
                    : `https://cdn.discordapp.com/embed/avatars/${parseInt(profile.id) % 5}.png`,
                verified: profile.verified,
                loginTime: new Date(),
                guildMember: guildMember.isMember,
                hasRole: guildMember.hasRole,
                uploads: [],
                totalUploadSize: 0,
                quota: 5 * 1024 * 1024 * 1024 // 5GB per user
            };

            // Store user data
            userStore.set(profile.id, user);
            
            // Initialize upload tracking if not exists
            if (!userUploads.has(profile.id)) {
                userUploads.set(profile.id, {
                    totalSize: 0,
                    uploads: [],
                    quota: 5 * 1024 * 1024 * 1024 // 5GB per user
                });
            }            if (!guildMember.isMember) {
                console.log(`❌ User ${user.username}#${user.discriminator} is not a member of VillainArc guild`);
                console.log(`🚧 TEMPORARILY ALLOWING LOGIN FOR DEBUGGING`);
                // return done(null, false, { message: 'Not a member of VillainArc guild' });
            }

            if (!guildMember.hasRole) {
                console.log(`❌ User ${user.username}#${user.discriminator} does not have required role in VillainArc guild`);
                console.log(`🚧 TEMPORARILY ALLOWING LOGIN FOR DEBUGGING`);
                // return done(null, false, { message: 'Does not have required role in VillainArc guild' });
            }

            console.log(`✅ VillainArc member authenticated: ${user.username}#${user.discriminator}`);
            return done(null, user);
        } catch (error) {
            console.error('Error during Discord authentication:', error);
            return done(error, null);
        }
    }));    // Function to check guild membership and roles
    async function checkGuildMembership(accessToken, userId) {
        try {
            console.log(`🔍 Checking guild membership for user ${userId}`);
            
            // Get user's guilds
            const guildsResponse = await fetch('https://discord.com/api/users/@me/guilds', {
                headers: {
                    'Authorization': `Bearer ${accessToken}`
                }
            });
            
            console.log(`📡 Guild fetch response status: ${guildsResponse.status}`);
            
            if (!guildsResponse.ok) {
                const errorText = await guildsResponse.text();
                console.error('❌ Failed to fetch user guilds:', guildsResponse.status, errorText);
                throw new Error(`Failed to fetch user guilds: ${guildsResponse.status}`);
            }
            
            const guilds = await guildsResponse.json();
            console.log(`🏰 User is member of ${guilds.length} guilds`);
            console.log(`🎯 Looking for guild ID: ${VILLAINARC_GUILD_ID}`);
            
            const isInGuild = guilds.some(guild => guild.id === VILLAINARC_GUILD_ID);
            console.log(`🏰 Is user in VillainArc guild? ${isInGuild}`);
            
            if (!isInGuild) {
                console.log('❌ User is not in VillainArc guild');
                return { isMember: false, hasRole: false };
            }

            // Check if user has required role in the guild
            console.log(`🤖 Checking roles with bot token...`);
            const memberResponse = await fetch(`https://discord.com/api/guilds/${VILLAINARC_GUILD_ID}/members/${userId}`, {
                headers: {
                    'Authorization': `Bot ${process.env.DISCORD_BOT_TOKEN}`
                }
            });

            console.log(`🤖 Member fetch response status: ${memberResponse.status}`);

            if (!memberResponse.ok) {
                const errorText = await memberResponse.text();
                console.error('❌ Failed to fetch member details:', memberResponse.status, errorText);
                // If we can't fetch member details, assume they don't have the role
                return { isMember: true, hasRole: false };
            }

            const member = await memberResponse.json();
            console.log(`👤 Member roles:`, member.roles);
            console.log(`🎭 Required roles:`, REQUIRED_ROLES);
            
            const hasRequiredRole = member.roles.some(roleId => REQUIRED_ROLES.includes(roleId));
            console.log(`✅ Has required role? ${hasRequiredRole}`);

            return { isMember: true, hasRole: hasRequiredRole };
        } catch (error) {
            console.error('❌ Error checking guild membership:', error);
            return { isMember: false, hasRole: false };
        }
    }passport.serializeUser((user, done) => {
        // Store the entire user object in the session, not just the ID
        done(null, user);
    });    passport.deserializeUser((user, done) => {
        // The user object is already complete from the session
        // No need to look it up in userStore since it's stored in the session
        if (user && user.id) {
            // Update userStore with the session data (in case server restarted)
            userStore.set(user.id, user);
            done(null, user);
        } else {
            // If no user data in session, just return null (not an error)
            // This happens during initial login before user is authenticated
            done(null, null);
        }
    });

    // Auth routes
    app.get('/auth/discord', passport.authenticate('discord'));    app.get('/auth/discord/callback',
        passport.authenticate('discord', { 
            failureRedirect: `${process.env.FRONTEND_URL}/?error=auth_failed&reason=guild_access` 
        }),
        (req, res) => {
            // Successful authentication - redirect to frontend
            console.log(`🎉 VillainArc member ${req.user.username} logged in successfully`);
            res.redirect(`${process.env.FRONTEND_URL}/?auth=success`);
        }
    );app.get('/auth/logout', (req, res) => {
        if (req.user) {
            console.log(`👋 User ${req.user.username} logged out`);
        }
        req.logout((err) => {
            if (err) {
                console.error('Logout error:', err);
            }
            res.redirect(process.env.FRONTEND_URL || '/');
        });
    });    // User info endpoint
    app.get('/api/user', (req, res) => {
        console.log('🔍 /api/user endpoint hit');
        console.log('Session ID:', req.sessionID);
        console.log('User in session:', req.user ? `${req.user.username}#${req.user.discriminator}` : 'None');
        
        if (!req.user) {
            console.log('❌ No user in session, returning 401');
            return res.status(401).json({ error: 'Not authenticated' });
        }

        const userUploadData = userUploads.get(req.user.id) || {
            totalSize: 0,
            uploads: [],
            quota: 5 * 1024 * 1024 * 1024
        };

        console.log('✅ Returning user data for:', req.user.username);        res.json({
            id: req.user.id,
            username: req.user.username,
            discriminator: req.user.discriminator,
            avatar: req.user.avatar,
            verified: req.user.verified,
            loginTime: req.user.loginTime,
            guildMember: req.user.guildMember,
            hasRole: req.user.hasRole,
            uploadStats: {
                totalSize: userUploadData.totalSize,
                uploadCount: userUploadData.uploads.length,
                quota: userUploadData.quota,
                remainingQuota: userUploadData.quota - userUploadData.totalSize,
                quotaPercentUsed: (userUploadData.totalSize / userUploadData.quota)
            }
        });
    });

    // User dashboard endpoint
    app.get('/api/user/uploads', (req, res) => {
        if (!req.user) {
            return res.status(401).json({ error: 'Not authenticated' });
        }

        const userUploadData = userUploads.get(req.user.id) || {
            totalSize: 0,
            uploads: [],
            quota: 5 * 1024 * 1024 * 1024
        };

        res.json({
            uploads: userUploadData.uploads,
            totalSize: userUploadData.totalSize,
            uploadCount: userUploadData.uploads.length,
            quota: userUploadData.quota,
            remainingQuota: userUploadData.quota - userUploadData.totalSize
        });
    });

    console.log('✅ Discord OAuth2 authentication configured');
    return true;
};

// Middleware to check if user is authenticated
const requireAuth = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    next();
};

// Middleware to check upload quota
const checkUploadQuota = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ error: 'Authentication required' });
    }

    const userUploadData = userUploads.get(req.user.id) || {
        totalSize: 0,
        uploads: [],
        quota: 5 * 1024 * 1024 * 1024
    };

    // Check if user has quota remaining
    const remainingQuota = userUploadData.quota - userUploadData.totalSize;
    
    if (remainingQuota <= 0) {
        return res.status(429).json({ 
            error: 'Upload quota exceeded',
            quotaUsed: userUploadData.totalSize,
            quota: userUploadData.quota
        });
    }

    // Store remaining quota in request for later use
    req.userQuota = {
        remaining: remainingQuota,
        total: userUploadData.quota,
        used: userUploadData.totalSize
    };

    next();
};

// Function to record a successful upload
const recordUpload = (userId, videoData) => {
    if (!userUploads.has(userId)) {
        userUploads.set(userId, {
            totalSize: 0,
            uploads: [],
            quota: 5 * 1024 * 1024 * 1024
        });
    }

    const userUploadData = userUploads.get(userId);
    userUploadData.totalSize += videoData.size;
    userUploadData.uploads.push({
        id: videoData.id,
        originalName: videoData.originalName,
        size: videoData.size,
        uploadDate: videoData.uploadDate,
        shareLink: videoData.shareLink
    });

    userUploads.set(userId, userUploadData);
    console.log(`📊 Upload recorded for user ${userId}: ${videoData.originalName} (${videoData.size} bytes)`);
};

// Get user upload stats
const getUserUploadStats = (userId) => {
    return userUploads.get(userId) || {
        totalSize: 0,
        uploads: [],
        quota: 5 * 1024 * 1024 * 1024
    };
};

module.exports = {
    setupDiscordAuth,
    requireAuth,
    checkUploadQuota,
    recordUpload,
    getUserUploadStats,
    userStore,
    userUploads
};
