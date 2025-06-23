const express = require('express');
const router = express.Router();

// Store active upload progress sessions
const uploadSessions = new Map();

// SSE endpoint for upload progress
router.get('/progress/:uploadId', (req, res) => {
    const { uploadId } = req.params;
    
    // Set SSE headers
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Cache-Control'
    });

    // Send initial connection message
    res.write(`data: ${JSON.stringify({ type: 'connected', uploadId })}\n\n`);

    // Store the response object for this upload session
    if (!uploadSessions.has(uploadId)) {
        uploadSessions.set(uploadId, []);
    }
    uploadSessions.get(uploadId).push(res);

    // Handle client disconnect
    req.on('close', () => {
        const sessions = uploadSessions.get(uploadId);
        if (sessions) {
            const index = sessions.indexOf(res);
            if (index !== -1) {
                sessions.splice(index, 1);
            }
            if (sessions.length === 0) {
                uploadSessions.delete(uploadId);
            }
        }
    });
});

// Function to broadcast progress to all clients listening to an upload
const broadcastProgress = (uploadId, progressData) => {
    const sessions = uploadSessions.get(uploadId);
    if (sessions && sessions.length > 0) {
        const message = `data: ${JSON.stringify(progressData)}\n\n`;
        sessions.forEach(res => {
            try {
                res.write(message);
            } catch (error) {
                console.error('Error sending SSE message:', error);
            }
        });
    }
};

// Function to complete and cleanup upload session
const completeUpload = (uploadId, result) => {
    broadcastProgress(uploadId, { type: 'complete', ...result });
    
    // Close all connections for this upload
    const sessions = uploadSessions.get(uploadId);
    if (sessions) {
        sessions.forEach(res => {
            try {
                res.write(`data: ${JSON.stringify({ type: 'close' })}\n\n`);
                res.end();
            } catch (error) {
                console.error('Error closing SSE connection:', error);
            }
        });
        uploadSessions.delete(uploadId);
    }
};

module.exports = {
    router,
    broadcastProgress,
    completeUpload
};
