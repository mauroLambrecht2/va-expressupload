const multer = require('multer');
const config = require('../config');

// Optimized storage configuration for faster uploads
const storage = multer.memoryStorage();

// File size and type limits - increased for faster processing
const MAX_FILE_SIZE = 1024 * 1024 * 1024; // 1GB
const FIELD_SIZE_LIMIT = 10 * 1024 * 1024; // 10MB for field data

// File filter to validate video files
const fileFilter = (req, file, cb) => {
    const allowedMimeTypes = [
        'video/mp4',
        'video/webm', 
        'video/ogg',
        'video/quicktime',
        'video/x-msvideo', // AVI
        'video/x-matroska', // MKV
        'video/mpeg'
    ];

    if (allowedMimeTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error(`Invalid file type. Allowed types: ${allowedMimeTypes.join(', ')}`), false);
    }
};

const upload = multer({ 
    storage,
    fileFilter,
    limits: {
        fileSize: MAX_FILE_SIZE,
        fieldSize: FIELD_SIZE_LIMIT,
        files: 1,
        fields: 10,
        fieldNameSize: 100,
        parts: 50 // Allow more parts for better handling
    }
});

// Enhanced error handling middleware
const handleUploadError = (error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        console.error('❌ Multer upload error:', error.message);
        
        switch (error.code) {
            case 'LIMIT_FILE_SIZE':
                return res.status(413).json({ 
                    error: `File too large. Maximum size is ${Math.round(config.upload.maxFileSize / (1024 * 1024))}MB`,
                    code: 'FILE_TOO_LARGE'
                });
            case 'LIMIT_FILE_COUNT':
                return res.status(400).json({ 
                    error: 'Too many files. Only one file allowed per upload.',
                    code: 'TOO_MANY_FILES'
                });
            case 'LIMIT_UNEXPECTED_FILE':
                return res.status(400).json({ 
                    error: 'Unexpected file field. Use "video" field name.',
                    code: 'UNEXPECTED_FIELD'
                });
            default:
                return res.status(400).json({ 
                    error: `Upload error: ${error.message}`,
                    code: 'UPLOAD_ERROR'
                });
        }
    } else if (error) {
        console.error('❌ General upload error:', error.message);
        return res.status(400).json({ 
            error: error.message,
            code: 'VALIDATION_ERROR'
        });
    }
    
    next();
};

module.exports = upload;
module.exports.handleUploadError = handleUploadError;
