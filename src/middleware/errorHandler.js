const multer = require('multer');

// Error handling middleware
const errorHandler = (error, req, res, next) => {
    console.error('Server error details:', {
        message: error.message,
        code: error.code,
        stack: error.stack?.substring(0, 500)
    });
    
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: 'File too large. Maximum size is 1GB.' });
        }
        if (error.code === 'LIMIT_UNEXPECTED_FILE') {
            return res.status(400).json({ error: 'Unexpected file field.' });
        }
        return res.status(400).json({ error: `Upload error: ${error.message}` });
    }
    
    if (error.message && error.message.includes('Filename contains invalid characters')) {
        return res.status(400).json({ error: 'Filename contains invalid characters!' });
    }
    
    if (error.message && error.message.includes('Only video files are allowed')) {
        return res.status(400).json({ error: 'Only video files are allowed!' });
    }

    // Generic server errors
    res.status(500).json({ 
        error: 'Internal server error. Please try again.',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
};

module.exports = errorHandler;
