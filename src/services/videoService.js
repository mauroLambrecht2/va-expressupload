
const path = require('path');
const crypto = require('crypto');
const { generateBlobSASQueryParameters, BlobSASPermissions } = require('@azure/storage-blob');
const { getBlobServiceClient, getSharedKeyCredential } = require('../config/azure');
const { videoStore } = require('../config/database');
const config = require('../config');
const { 
    uploadVideoStreamToAzure, 
    uploadVideoBufferToAzure, 
    createProgressStream, 
    shouldUseStreamingUpload 
} = require('./streamingUploadService');

const uploadVideoToAzure = async (file, user, ip, progressCallback) => {
    const blobServiceClient = getBlobServiceClient();
    
    if (!blobServiceClient) {
        throw new Error('Azure Blob Storage not configured');
    }

    console.log(`📤 Processing upload: ${file.originalname} (${file.size} bytes)`);

    // Determine upload method based on file size
    if (shouldUseStreamingUpload(file.size)) {
        console.log(`🌊 Using streaming upload for large file: ${file.originalname}`);
        
        // Create a stream from the buffer with progress tracking
        const progressStream = createProgressStream(file.buffer, (progress) => {
            const percentage = ((progress.loadedBytes / progress.totalBytes) * 100).toFixed(1);
            console.log(`📤 Upload progress: ${percentage}%`);
            
            // Forward progress to callback if provided
            if (progressCallback) {
                progressCallback({
                    type: 'progress',
                    progress: Math.round(percentage),
                    bytesUploaded: progress.loadedBytes,
                    totalBytes: progress.totalBytes
                });
            }
        });
        
        return await uploadVideoStreamToAzure(
            progressStream,
            file.size,
            file.originalname,
            user,
            ip,
            progressCallback
        );
    } else {
        console.log(`💾 Using buffer upload for small file: ${file.originalname}`);
        return await uploadVideoBufferToAzure(
            file.buffer,
            file.originalname,
            user,
            ip,
            progressCallback
        );
    }
};

const generateStreamUrl = async (videoId) => {
    const blobServiceClient = getBlobServiceClient();
    const sharedKeyCredential = getSharedKeyCredential();
    const videoData = videoStore.get(videoId);

    if (!videoData || !blobServiceClient || !sharedKeyCredential) {
        throw new Error('Video not found or Azure not configured');
    }

    const containerClient = blobServiceClient.getContainerClient(videoData.containerName);
    const blockBlobClient = containerClient.getBlockBlobClient(videoData.blobName);

    // Check if blob exists
    const exists = await blockBlobClient.exists();
    if (!exists) {
        throw new Error('Video file not found in storage');
    }

    // Generate a temporary SAS URL that expires in 1 hour
    const sasOptions = {
        containerName: videoData.containerName,
        blobName: videoData.blobName,
        permissions: BlobSASPermissions.parse('r'), // read permission only
        startsOn: new Date(),
        expiresOn: new Date(new Date().valueOf() + 60 * 60 * 1000), // 1 hour from now
    };

    const sasToken = generateBlobSASQueryParameters(sasOptions, sharedKeyCredential).toString();
    const sasUrl = `${blockBlobClient.url}?${sasToken}`;
    
    return sasUrl;
};

const getVideoProperties = async (videoId) => {
    const blobServiceClient = getBlobServiceClient();
    const videoData = videoStore.get(videoId);

    if (!videoData || !blobServiceClient) {
        throw new Error('Video not found or Azure not configured');
    }

    const containerClient = blobServiceClient.getContainerClient(videoData.containerName);
    const blockBlobClient = containerClient.getBlockBlobClient(videoData.blobName);

    try {
        const properties = await blockBlobClient.getProperties();
        return {
            contentLength: properties.contentLength || videoData.size,
            contentType: videoData.fileFormat === '.mkv' || videoData.isMKV ? 'video/mp4' : videoData.contentType,
            lastModified: properties.lastModified,
            etag: properties.etag
        };
    } catch (error) {
        console.error('❌ Error getting video properties:', error);
        throw error;
    }
};

// Download video blob as stream with optional range support
const downloadVideoBlob = async (videoId, startByte = null, endByte = null) => {
    const blobServiceClient = getBlobServiceClient();
    const videoData = videoStore.get(videoId);

    if (!videoData || !blobServiceClient) {
        throw new Error('Video not found or Azure not configured');
    }

    const containerClient = blobServiceClient.getContainerClient(videoData.containerName);
    const blockBlobClient = containerClient.getBlockBlobClient(videoData.blobName);

    try {
        // Check if blob exists
        const exists = await blockBlobClient.exists();
        if (!exists) {
            throw new Error('Video file not found in storage');
        }

        let downloadResponse;
        if (startByte !== null && endByte !== null) {
            // Range download
            console.log(`📥 Downloading range ${startByte}-${endByte} of ${videoData.blobName}`);
            downloadResponse = await blockBlobClient.download(startByte, endByte - startByte + 1);
        } else {
            // Full download
            console.log(`📥 Downloading full blob: ${videoData.blobName}`);
            downloadResponse = await blockBlobClient.download();
        }

        return downloadResponse.readableStreamBody;
    } catch (error) {
        console.error('❌ Error downloading video blob:', error);
        throw error;
    }
};

module.exports = {
    uploadVideoToAzure,
    generateStreamUrl,
    getVideoProperties,
    downloadVideoBlob
};
