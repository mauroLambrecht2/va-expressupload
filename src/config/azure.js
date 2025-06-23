const { BlobServiceClient, StorageSharedKeyCredential, generateBlobSASQueryParameters, BlobSASPermissions } = require('@azure/storage-blob');
const config = require('./index');

let blobServiceClient = null;
let sharedKeyCredential = null;

const initializeAzureStorage = () => {
    const { accountName, accountKey, containerName } = config.azure;
    
    if (!accountName || !accountKey) {
        console.log('⚠️  Azure Storage not configured - file storage will be limited');
        return null;
    }

    try {
        console.log('🔗 Connecting to Azure Blob Storage...');
        sharedKeyCredential = new StorageSharedKeyCredential(accountName, accountKey);
        blobServiceClient = new BlobServiceClient(
            `https://${accountName}.blob.core.windows.net`,
            sharedKeyCredential
        );
        
        console.log('✅ Azure Blob Storage connected successfully');
        return { blobServiceClient, sharedKeyCredential };
    } catch (error) {
        console.error('❌ Failed to initialize Azure Storage:', error.message);
        return null;
    }
};

module.exports = {
    initializeAzureStorage,
    getBlobServiceClient: () => blobServiceClient,
    getSharedKeyCredential: () => sharedKeyCredential
};
