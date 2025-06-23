const fs = require('fs');
const path = require('path');
const { getBlobServiceClient } = require('../config/azure');
const { videoStore } = require('../config/database');
const config = require('../config');

// Function to rebuild video store from existing files
const rebuildVideoStore = async () => {
    if (getBlobServiceClient()) {
        await rebuildFromAzureStorage();
    } else {
        await rebuildFromLocalStorage();
    }
};

// Rebuild video store from Azure Blob Storage
const rebuildFromAzureStorage = async () => {
    const blobServiceClient = getBlobServiceClient();
    if (!blobServiceClient) {
        console.log('⚠️  Azure Blob Storage not configured - skipping video store rebuild');
        return;
    }
    
    try {
        console.log('🔄 Rebuilding video store from Azure Blob Storage...');
        const containerClient = blobServiceClient.getContainerClient(config.azure.containerName);
        
        let count = 0;
        for await (const blob of containerClient.listBlobsFlat({ includeMetadata: true })) {
            if (blob.metadata && blob.metadata.videoId) {
                const videoData = {
                    id: blob.metadata.videoId,
                    originalName: blob.metadata.originalName || blob.name,
                    blobUrl: `https://${config.azure.accountName}.blob.core.windows.net/${config.azure.containerName}/${blob.name}`,
                    blobName: blob.name,
                    containerName: config.azure.containerName,
                    size: parseInt(blob.metadata.size) || blob.properties.contentLength,
                    contentType: blob.metadata.contentType || blob.properties.contentType,
                    uploadDate: new Date(blob.metadata.uploadDate) || blob.properties.lastModified,
                    downloadCount: parseInt(blob.metadata.downloadCount) || 0,
                    ip: blob.metadata.uploaderIp || 'Unknown',
                    uploadedBy: blob.metadata.uploadedBy || 'Unknown',
                    uploaderUsername: blob.metadata.uploaderUsername || 'Unknown User',
                    uploaderAvatar: blob.metadata.uploaderAvatar || '',
                    fileFormat: blob.metadata.fileFormat || path.extname(blob.name),
                    isMKV: blob.metadata.isMKV === 'true'
                };
                
                videoStore.set(blob.metadata.videoId, videoData);
                count++;
            }
        }
        
        console.log(`✅ Rebuilt video store with ${count} videos from Azure Blob Storage`);
    } catch (error) {
        console.error('❌ Failed to rebuild video store from Azure:', error.message);
    }
};

// Rebuild video store from local filesystem
const rebuildFromLocalStorage = async () => {
    try {
        const uploadsDir = path.join(__dirname, '../../uploads');
        if (!fs.existsSync(uploadsDir)) {
            console.log('📁 No uploads directory found, starting fresh');
            return;
        }

        console.log('🔄 Rebuilding video store from local filesystem...');
        const files = fs.readdirSync(uploadsDir);
        let count = 0;

        for (const file of files) {
            if (file.endsWith('.json')) continue; // Skip metadata files
            
            const filePath = path.join(uploadsDir, file);
            const stats = fs.statSync(filePath);
            const fileExtension = path.extname(file);
            const videoId = path.basename(file, fileExtension);
            
            const videoData = {
                id: videoId,
                originalName: file,
                filePath: filePath,
                size: stats.size,
                uploadDate: stats.birthtime,
                downloadCount: 0,
                fileFormat: fileExtension
            };
            
            videoStore.set(videoId, videoData);
            count++;
        }
        
        console.log(`✅ Rebuilt video store with ${count} videos from local filesystem`);
    } catch (error) {
        console.error('❌ Failed to rebuild video store:', error.message);
    }
};

// Configure Azure Blob Storage CORS with multiple fallback approaches
const configureAzureCORS = async () => {
    const blobServiceClient = getBlobServiceClient();
    if (!blobServiceClient) {
        return;
    }
    
    try {
        console.log('🔧 Configuring Azure Blob Storage CORS...');
        
        const corsRules = [{
            allowedOrigins: ['*'],
            allowedMethods: ['GET', 'HEAD', 'OPTIONS'],
            allowedHeaders: ['Range', 'Accept-Encoding', 'Accept-Ranges', 'Content-Type', 'Authorization'],
            exposedHeaders: ['Content-Range', 'Accept-Ranges', 'Content-Length', 'Content-Type'],
            maxAgeInSeconds: 86400 // 24 hours
        }];

        await blobServiceClient.setProperties({
            cors: corsRules
        });
        
        console.log('✅ Azure CORS configured successfully');
    } catch (error) {
        console.error('❌ Failed to configure Azure CORS:', error.message);
        console.log('💡 Manual CORS configuration may be required in Azure Portal');
    }
};

// Set Azure container to public access
const setContainerPublicAccess = async () => {
    const blobServiceClient = getBlobServiceClient();
    if (!blobServiceClient) {
        return;
    }
    
    try {
        const containerClient = blobServiceClient.getContainerClient(config.azure.containerName);
        const containerExists = await containerClient.exists();
        
        if (!containerExists) {
            console.log(`📁 Creating Azure container: ${config.azure.containerName}`);
            await containerClient.create({
                access: 'blob' // Public read access for blobs
            });
            console.log('✅ Azure container created with public blob access');
        } else {
            // Try to set public access on existing container
            await containerClient.setAccessPolicy('blob');
            console.log('✅ Azure container configured for public blob access');
        }
        
    } catch (error) {
        console.error('❌ Failed to set container public access:', error.message);
        console.log('💡 You may need to set this manually in Azure Portal:');
        console.log('   1. Go to Azure Portal -> Your Storage Account');
        console.log('   2. Navigate to Containers -> Select your container');
        console.log('   3. Change "Public access level" to "Blob (anonymous read access for blobs only)"');
    }
};

// Set Azure Storage service version
const setAzureStorageVersion = async () => {
    const blobServiceClient = getBlobServiceClient();
    if (!blobServiceClient) {
        return;
    }
    
    try {
        // Set service properties for better video streaming compatibility
        await blobServiceClient.setProperties({
            defaultServiceVersion: '2020-04-08'
        });
        
        console.log('✅ Azure Storage service version configured');
    } catch (error) {
        console.error('❌ Failed to set Azure service version:', error.message);
    }
};

// Initialize Azure configuration
const initializeAzureConfiguration = async () => {
    if (getBlobServiceClient()) {
        await setContainerPublicAccess();
        await setAzureStorageVersion();
        await configureAzureCORS();
        await rebuildVideoStore();
    }
};

module.exports = {
    rebuildVideoStore,
    rebuildFromAzureStorage,
    rebuildFromLocalStorage,
    configureAzureCORS,
    setContainerPublicAccess,
    setAzureStorageVersion,
    initializeAzureConfiguration
};
