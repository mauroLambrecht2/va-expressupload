const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const config = require('../config');
const { userStore } = require('../config/database');

// Cache for guild membership checks to avoid repeated API calls
const guildMembershipCache = new Map();
const CACHE_DURATION = 30 * 60 * 1000; // 30 minutes (increased)

// Rate limiting for Discord API calls
let lastDiscordApiCall = 0;
const DISCORD_API_COOLDOWN = 3000; // 3 seconds between calls (increased)

const setupDiscordAuth = (app) => {
    const { clientId, clientSecret, redirectUri } = config.discord;

    if (!clientId || !clientSecret || !redirectUri) {
        console.log('⚠️  Discord OAuth2 not configured - skipping authentication setup');
        return false;
    }

    console.log('🔐 Setting up Discord OAuth2 authentication...');

    // Passport setup
    passport.use(new DiscordStrategy({
        clientID: clientId,
        clientSecret: clientSecret,
        callbackURL: redirectUri,
        scope: ['identify', 'guilds']    }, async (accessToken, refreshToken, profile, done) => {
        try {
            console.log(`🔍 Discord auth callback for user: ${profile.username}#${profile.discriminator} (${profile.id})`);
            
            // Check guild membership with improved caching and rate limiting
            const guildMember = await checkGuildMembershipOptimized(profile.id, accessToken);
            console.log(`🏰 Guild membership check result:`, guildMember);
              
            // Check if user is allowed access
            if (!guildMember.isMember) {
                console.log(`❌ Access denied for ${profile.username}#${profile.discriminator} - not a guild member`);
                return done(null, false, { message: 'Not a member of the required Discord server' });
            }

            if (!guildMember.hasRole && !guildMember.fallback) {
                console.log(`❌ Access denied for ${profile.username}#${profile.discriminator} - missing required role`);
                return done(null, false, { message: 'Missing required role in Discord server' });
            }            // Get existing user data or create new user
            const existingUser = userStore.get(profile.id);
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
                needsVerification: guildMember.needsVerification || false,
                // Preserve existing upload data if available
                uploads: existingUser?.uploads || [],
                totalUploadSize: existingUser?.totalUploadSize || 0,
                quota: existingUser?.quota || config.upload.userQuota
            };

            userStore.set(profile.id, user);
            console.log(`✅ User authenticated: ${profile.username}#${profile.discriminator} (verified: ${!user.needsVerification})`);
            
            return done(null, user);
        } catch (error) {
            console.error('❌ Discord auth error:', error);
            return done(error, null);
        }
    }));

    passport.serializeUser((user, done) => {
        done(null, user.id);
    });

    passport.deserializeUser(async (id, done) => {
        try {
            const user = userStore.get(id);
            done(null, user);
        } catch (error) {
            console.error('❌ User deserialization error:', error);
            done(error, null);
        }
    });

    app.use(passport.initialize());
    app.use(passport.session());
    
    console.log('✅ Discord OAuth2 authentication configured');
    return true;
};

// Optimized guild membership check using bot token when available
const checkGuildMembershipOptimized = async (userId, accessToken = null) => {
    // Check cache first
    const cacheKey = `guild_${userId}_${Math.floor(Date.now() / CACHE_DURATION)}`;
    if (guildMembershipCache.has(cacheKey)) {
        console.log(`🔄 Using cached guild membership for user ${userId}`);
        return guildMembershipCache.get(cacheKey);
    }

    // Try bot token first (if available) - more reliable and has higher rate limits
    const botToken = process.env.DISCORD_BOT_TOKEN;
    if (botToken) {
        try {
            const result = await checkGuildMembershipWithBot(userId, botToken);
            if (result) {
                guildMembershipCache.set(cacheKey, result);
                return result;
            }
        } catch (error) {
            console.log('🤖 Bot token check failed, trying user token:', error.message);
        }
    }

    // Fall back to user token method if bot token is unavailable or failed
    if (accessToken) {
        try {
            const now = Date.now();
            const timeSinceLastCall = now - lastDiscordApiCall;
            if (timeSinceLastCall < DISCORD_API_COOLDOWN) {
                const waitTime = DISCORD_API_COOLDOWN - timeSinceLastCall;
                console.log(`⏳ Rate limiting: waiting ${waitTime}ms before Discord API call`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
            }

            lastDiscordApiCall = Date.now();
            const result = await checkGuildMembershipWithUserToken(accessToken, userId);
            
            // Cache the result
            guildMembershipCache.set(cacheKey, result);
            return result;
        } catch (error) {
            console.log('👤 User token check failed:', error.message);
        }
    }    // Ultimate fallback handling based on environment
    if (process.env.NODE_ENV === 'development') {
        // In development, allow access when checks fail
        const fallbackResult = { 
            isMember: true, 
            hasRole: true, 
            needsVerification: true,
            fallback: 'development'
        };
        
        console.log(`⚠️ Development mode: allowing access for user ${userId}`);
        
        // Cache fallback result for shorter time
        const shortCacheKey = `guild_fallback_${userId}_${Math.floor(Date.now() / (5 * 60 * 1000))}`;
        guildMembershipCache.set(shortCacheKey, fallbackResult);
        
        return fallbackResult;
    } else {
        // In production, deny access when both checks fail
        console.log(`❌ Production mode: denying access for user ${userId} - all checks failed`);
        const denyResult = { 
            isMember: false, 
            hasRole: false, 
            error: 'Guild membership verification failed'
        };
        return denyResult;
    }
};

// Check guild membership using bot token
const checkGuildMembershipWithBot = async (userId, botToken) => {
    console.log(`🤖 Checking guild membership using bot token for user ${userId}`);
    
    try {
        const memberResponse = await fetch(`https://discord.com/api/v10/guilds/${config.discord.guildId}/members/${userId}`, {
            headers: {
                'Authorization': `Bot ${botToken}`,
                'Content-Type': 'application/json'
            },
            timeout: 5000 // 5 second timeout
        });

        if (memberResponse.status === 404) {
            console.log(`❌ User ${userId} is not a member of the guild (bot check)`);
            return { isMember: false, hasRole: false };
        }

        if (memberResponse.status === 401) {
            throw new Error('Bot token is invalid or bot lacks permissions');
        }

        if (memberResponse.status === 403) {
            throw new Error('Bot lacks permissions to access guild members');
        }

        if (!memberResponse.ok) {
            throw new Error(`Bot guild check failed: ${memberResponse.status} ${memberResponse.statusText}`);
        }

        const member = await memberResponse.json();
        const hasRequiredRole = config.discord.requiredRoles.some(roleId => member.roles.includes(roleId));
        
        console.log(`🤖 Bot check result for user ${userId} - Member: true, HasRole: ${hasRequiredRole}, Roles: ${member.roles.length}`);
        return { isMember: true, hasRole: hasRequiredRole };
        
    } catch (error) {
        // Handle network errors, timeouts, etc.
        if (error.name === 'AbortError' || error.code === 'ECONNREFUSED') {
            throw new Error('Bot is offline or Discord API is unreachable');
        }
        throw error;
    }
};

// Check guild membership using user access token
const checkGuildMembershipWithUserToken = async (accessToken, userId) => {
    console.log(`👤 Checking guild membership using user token for user ${userId}`);
    
    // Get user's guilds
    const guildsResponse = await fetch('https://discord.com/api/users/@me/guilds', {
        headers: {
            'Authorization': `Bearer ${accessToken}`
        }
    });

    if (!guildsResponse.ok) {
        const error = new Error(`Failed to fetch user guilds: ${guildsResponse.status} ${guildsResponse.statusText}`);
        error.status = guildsResponse.status;
        
        // Check for rate limit headers
        if (guildsResponse.status === 429) {
            const retryAfter = guildsResponse.headers.get('Retry-After');
            error.retryAfter = retryAfter ? parseInt(retryAfter) : 5;
        }
        
        throw error;
    }

    const guilds = await guildsResponse.json();
    const villainArcGuild = guilds.find(guild => guild.id === config.discord.guildId);
    
    if (!villainArcGuild) {
        console.log(`❌ User ${userId} is not a member of VillainArc guild`);
        return { isMember: false, hasRole: false };
    }

    // Try to check user roles using guild member endpoint
    try {
        console.log(`👤 Checking roles for user ${userId} in guild ${config.discord.guildId}`);
        
        const memberResponse = await fetch(`https://discord.com/api/guilds/${config.discord.guildId}/members/${userId}`, {
            headers: {
                'Authorization': `Bearer ${accessToken}`
            }
        });

        if (memberResponse.ok) {
            const member = await memberResponse.json();
            const hasRequiredRole = config.discord.requiredRoles.some(roleId => member.roles.includes(roleId));
            
            console.log(`✓ User ${userId} guild membership - Member: true, HasRole: ${hasRequiredRole}, Roles: ${member.roles.length}`);
            return { isMember: true, hasRole: hasRequiredRole };
        } else {
            console.log(`⚠️ Could not check roles for user ${userId} (status: ${memberResponse.status}), allowing access`);
            // If we can't check roles but they are in the guild, allow access
            return { isMember: true, hasRole: true, roleCheckFailed: true };
        }
    } catch (roleError) {
        console.log(`⚠️ Role check error for user ${userId}:`, roleError.message);
        // If role check fails but they are in the guild, allow access
        return { isMember: true, hasRole: true, roleCheckFailed: true };
    }
};

const getDiscordAvatarUrl = (user) => {
    if (!user) return null;
    
    if (user.avatar && user.id) {
        return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`;
    }
    
    // Better fallback calculation for users without custom avatars
    if (user.discriminator && user.discriminator !== '0') {
        return `https://cdn.discordapp.com/embed/avatars/${parseInt(user.discriminator) % 5}.png`;
    } else {
        return `https://cdn.discordapp.com/embed/avatars/${parseInt(user.id) % 5}.png`;
    }
};

// Cleanup old cache entries periodically
setInterval(() => {
    const now = Date.now();
    const cutoff = now - CACHE_DURATION;
    let cleanedCount = 0;
    
    for (const [key] of guildMembershipCache.entries()) {
        const keyTimestamp = parseInt(key.split('_').pop());
        if (isNaN(keyTimestamp) || keyTimestamp < cutoff) {
            guildMembershipCache.delete(key);
            cleanedCount++;
        }
    }
    
    if (cleanedCount > 0) {
        console.log(`🧹 Cleaned up ${cleanedCount} old cache entries. Current size: ${guildMembershipCache.size}`);
    }
}, CACHE_DURATION); // Run cleanup every 30 minutes

module.exports = {
    setupDiscordAuth,
    getDiscordAvatarUrl,
    userStore
};
