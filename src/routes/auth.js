const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

// Auth routes
router.get('/discord', authController.login);
router.get('/discord/callback', authController.callback);
router.post('/logout', authController.logout);
router.get('/user', authController.getUserInfo);
router.get('/user/uploads', authController.getUserUploads);
router.get('/login-failed', authController.loginFailed);
router.post('/refresh-guild', authController.refreshGuildMembership);

// Test authentication endpoint
router.get('/test-auth', authController.testAuth);

// Debug routes (development only)
if (process.env.NODE_ENV !== 'production') {
    router.get('/debug/session', authController.debugSession);
}

module.exports = router;
