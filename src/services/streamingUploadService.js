const { getBlobServiceClient } = require('../config/azure');
const { videoStore, userStore } = require('../config/database');
const config = require('../config');
const crypto = require('crypto');
const path = require('path');
const { PassThrough } = require('stream');

// Optimized chunk size for faster uploads (50MB for better throughput)
const CHUNK_SIZE = 50 * 1024 * 1024; // 50MB chunks for faster upload
const MAX_RETRIES = 3;
const MAX_CONCURRENT_UPLOADS = 4; // Upload 4 chunks in parallel

/**
 * Upload video using Azure Block Blob streaming with optimized chunked upload
 * This prevents memory exhaustion while maximizing upload speed
 */
const uploadVideoStreamToAzure = async (fileStream, fileSize, originalName, user, uploaderIp, progressCallback) => {
    const blobServiceClient = getBlobServiceClient();
    if (!blobServiceClient) {
        throw new Error('Azure Blob Storage not configured');
    }

    // Generate unique video ID and blob name
    const videoId = crypto.randomBytes(16).toString('hex');
    const fileExtension = path.extname(originalName);
    const blobName = `${videoId}${fileExtension}`;
    
    console.log(`🚀 Starting optimized chunked upload for ${originalName} (${fileSize} bytes) in ${Math.ceil(fileSize / CHUNK_SIZE)} chunks`);

    const containerClient = blobServiceClient.getContainerClient(config.azure.containerName);
    const blockBlobClient = containerClient.getBlockBlobClient(blobName);

    try {
        // Use optimized upload with concurrent chunks and better buffering
        const uploadOptions = {
            blockSize: CHUNK_SIZE,
            concurrency: MAX_CONCURRENT_UPLOADS, // Upload multiple chunks simultaneously
            maxSingleShotSize: 100 * 1024 * 1024, // Use single upload for files under 100MB
            progress: (progress) => {
                const percentage = ((progress.loadedBytes / fileSize) * 100);
                console.log(`📤 Upload progress for ${videoId}: ${percentage.toFixed(1)}% (${progress.loadedBytes}/${fileSize} bytes)`);
                
                // Call progress callback if provided
                if (progressCallback) {
                    progressCallback({
                        type: 'progress',
                        uploadId: videoId,
                        progress: Math.round(percentage),
                        bytesUploaded: progress.loadedBytes,
                        totalBytes: fileSize,
                        speed: 0 // Speed will be calculated on client side
                    });
                }
            },
            metadata: {
                videoId,
                originalName,
                size: fileSize.toString(),
                contentType: getContentType(fileExtension),
                uploadDate: new Date().toISOString(),
                uploadedBy: user.id,
                uploaderUsername: user.username,
                uploaderAvatar: user.avatar || '',
                uploaderIp: uploaderIp,
                fileFormat: fileExtension,
                isMKV: (fileExtension.toLowerCase() === '.mkv').toString(),
                downloadCount: '0'
            }
        };

        // Upload the stream
        const uploadResponse = await blockBlobClient.uploadStream(
            fileStream,
            CHUNK_SIZE,
            2, // max concurrency
            uploadOptions
        );

        console.log(`✅ Successfully uploaded ${originalName} to Azure Blob Storage`);
        console.log(`📊 Upload stats: Request ID: ${uploadResponse.requestId}, ETag: ${uploadResponse.etag}`);

        // Create video data object
        const videoData = {
            id: videoId,
            originalName,
            blobUrl: blockBlobClient.url,
            blobName,
            containerName: config.azure.containerName,
            size: fileSize,
            contentType: getContentType(fileExtension),
            uploadDate: new Date(),
            downloadCount: 0,
            ip: uploaderIp,
            uploadedBy: user.id,
            uploaderUsername: user.username,
            uploaderAvatar: user.avatar || '',
            fileFormat: fileExtension,
            isMKV: fileExtension.toLowerCase() === '.mkv'
        };

        // Store video data
        videoStore.set(videoId, videoData);

        // Update user's upload statistics
        if (user) {
            const userData = userStore.get(user.id);
            if (userData) {
                userData.uploads = userData.uploads || [];
                userData.uploads.push({
                    id: videoId,
                    originalName,
                    size: fileSize,
                    uploadDate: new Date().toISOString(),
                    shareLink: `/v/${videoId}`
                });
                userData.totalUploadSize = (userData.totalUploadSize || 0) + fileSize;
                userStore.set(user.id, userData);
            }
        }

        return {
            videoId,
            videoData,
            warning: fileExtension.toLowerCase() === '.mkv' ? 
                'MKV files may not play in all browsers. Consider converting to MP4 for better compatibility.' : null
        };

    } catch (error) {
        console.error(`❌ Failed to upload ${originalName} to Azure:`, error);
        
        // Clean up any partial upload
        try {
            if (await blockBlobClient.exists()) {
                await blockBlobClient.delete();
                console.log(`🧹 Cleaned up partial upload for ${videoId}`);
            }
        } catch (cleanupError) {
            console.error('Failed to clean up partial upload:', cleanupError.message);
        }
        
        throw new Error(`Upload failed: ${error.message}`);
    }
};

/**
 * Upload video using traditional buffer method (fallback)
 * Only use this for small files or when streaming fails
 */
const uploadVideoBufferToAzure = async (fileBuffer, originalName, user, uploaderIp) => {
    const blobServiceClient = getBlobServiceClient();
    if (!blobServiceClient) {
        throw new Error('Azure Blob Storage not configured');
    }

    const videoId = crypto.randomBytes(16).toString('hex');
    const fileExtension = path.extname(originalName);
    const blobName = `${videoId}${fileExtension}`;
    
    console.log(`⚠️ Using buffer upload for ${originalName} (${fileBuffer.length} bytes)`);

    const containerClient = blobServiceClient.getContainerClient(config.azure.containerName);
    const blockBlobClient = containerClient.getBlockBlobClient(blobName);

    try {
        const uploadOptions = {
            metadata: {
                videoId,
                originalName,
                size: fileBuffer.length.toString(),
                contentType: getContentType(fileExtension),
                uploadDate: new Date().toISOString(),
                uploadedBy: user.id,
                uploaderUsername: user.username,
                uploaderAvatar: user.avatar || '',
                uploaderIp: uploaderIp,
                fileFormat: fileExtension,
                isMKV: (fileExtension.toLowerCase() === '.mkv').toString(),
                downloadCount: '0'
            },
            blobHTTPHeaders: {
                blobContentType: getContentType(fileExtension)
            }
        };

        const uploadResponse = await blockBlobClient.upload(fileBuffer, fileBuffer.length, uploadOptions);

        const videoData = {
            id: videoId,
            originalName,
            blobUrl: blockBlobClient.url,
            blobName,
            containerName: config.azure.containerName,
            size: fileBuffer.length,
            contentType: getContentType(fileExtension),
            uploadDate: new Date(),
            downloadCount: 0,
            ip: uploaderIp,
            uploadedBy: user.id,
            uploaderUsername: user.username,
            uploaderAvatar: user.avatar || '',
            fileFormat: fileExtension,
            isMKV: fileExtension.toLowerCase() === '.mkv'
        };

        videoStore.set(videoId, videoData);

        return {
            videoId,
            videoData,
            warning: fileExtension.toLowerCase() === '.mkv' ? 
                'MKV files may not play in all browsers. Consider converting to MP4 for better compatibility.' : null
        };

    } catch (error) {
        console.error(`❌ Failed to upload ${originalName} to Azure:`, error);
        throw new Error(`Upload failed: ${error.message}`);
    }
};

/**
 * Create a readable stream from a file buffer with progress tracking
 */
const createProgressStream = (buffer, onProgress) => {
    const stream = new PassThrough();
    let uploaded = 0;
    const total = buffer.length;

    stream.on('data', (chunk) => {
        uploaded += chunk.length;
        if (onProgress) {
            onProgress({ loadedBytes: uploaded, totalBytes: total });
        }
    });

    // Push the buffer to the stream in chunks
    let offset = 0;
    const pushChunk = () => {
        if (offset < total) {
            const chunkSize = Math.min(CHUNK_SIZE, total - offset);
            const chunk = buffer.slice(offset, offset + chunkSize);
            stream.push(chunk);
            offset += chunkSize;
            // Use setImmediate to prevent blocking the event loop
            setImmediate(pushChunk);
        } else {
            stream.push(null); // End the stream
        }
    };

    setImmediate(pushChunk);
    return stream;
};

/**
 * Get content type based on file extension
 */
const getContentType = (fileExtension) => {
    const contentTypes = {
        '.mp4': 'video/mp4',
        '.mov': 'video/quicktime',
        '.avi': 'video/x-msvideo',
        '.mkv': 'video/x-matroska',
        '.webm': 'video/webm',
        '.ogv': 'video/ogg',
        '.3gp': 'video/3gpp',
        '.flv': 'video/x-flv',
        '.wmv': 'video/x-ms-wmv'
    };
    
    return contentTypes[fileExtension.toLowerCase()] || 'application/octet-stream';
};

/**
 * Check if file should use streaming upload based on size
 */
const shouldUseStreamingUpload = (fileSize) => {
    // Use streaming for files larger than 50MB
    return fileSize > 50 * 1024 * 1024;
};

module.exports = {
    uploadVideoStreamToAzure,
    uploadVideoBufferToAzure,
    createProgressStream,
    shouldUseStreamingUpload,
    CHUNK_SIZE
};
