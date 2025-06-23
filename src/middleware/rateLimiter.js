const rateLimit = require('express-rate-limit');
const config = require('../config');

// Rate limiting - More restrictive for production
const uploadLimit = rateLimit({
    windowMs: config.rateLimit.upload.windowMs,
    max: config.rateLimit.upload.max,
    message: { error: 'Too many uploads from this IP, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
    trustProxy: config.server.nodeEnv === 'production',
    keyGenerator: (req) => {
        // Use user ID if authenticated, otherwise fall back to IP
        return req.user ? `user_${req.user.id}` : req.ip;
    }
});

// General API rate limiting
const apiLimit = rateLimit({
    windowMs: config.rateLimit.api.windowMs,
    max: config.rateLimit.api.max,
    message: { error: 'Too many requests, please slow down.' },
    standardHeaders: true,
    legacyHeaders: false,
    trustProxy: config.server.nodeEnv === 'production',
    keyGenerator: (req) => {
        return req.user ? `user_${req.user.id}` : req.ip;
    }
});

module.exports = {
    uploadLimit,
    apiLimit
};
