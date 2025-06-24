const { BlobServiceClient } = require('@azure/storage-blob');

const DEFAULT_QUOTA = 5 * 1024 * 1024 * 1024; // 5GB in bytes

class UserQuotaService {
    constructor() {
        this.connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
        this.containerName = 'videos';
    }

    // Calculate user's total upload size by scanning Azure blob storage
    async calculateUserTotalSize(userId) {
        try {
            const blobServiceClient = BlobServiceClient.fromConnectionString(this.connectionString);
            const containerClient = blobServiceClient.getContainerClient(this.containerName);

            let totalSize = 0;
            let uploadCount = 0;

            // List all blobs and sum up sizes for this user
            for await (const blob of containerClient.listBlobsFlat({ includeMetadata: true })) {
                // Check if this blob belongs to the user
                if (blob.metadata && blob.metadata.uploadedBy === userId) {
                    totalSize += blob.properties.contentLength || 0;
                    uploadCount++;
                }
            }

            console.log(`📊 User ${userId}: ${uploadCount} videos, ${(totalSize / 1024 / 1024).toFixed(2)} MB total`);

            return {
                totalUploadSize: totalSize,
                uploadCount: uploadCount
            };
        } catch (error) {
            console.error('❌ Failed to calculate user storage usage:', error);
            return {
                totalUploadSize: 0,
                uploadCount: 0
            };
        }
    }

    async getUserQuota(userId) {
        const usage = await this.calculateUserTotalSize(userId);
        return {
            quota: DEFAULT_QUOTA,
            totalUploadSize: usage.totalUploadSize,
            uploadCount: usage.uploadCount,
            lastUpdated: new Date().toISOString()
        };
    }

    async getUserRemainingQuota(userId) {
        const userQuota = await this.getUserQuota(userId);
        return Math.max(0, userQuota.quota - userQuota.totalUploadSize);
    }

    async canUserUpload(userId, fileSize) {
        const remainingQuota = await this.getUserRemainingQuota(userId);
        return fileSize <= remainingQuota;
    }

    // Get user stats for display
    async getUserStats(userId) {
        const userQuota = await this.getUserQuota(userId);
        const remainingQuota = Math.max(0, userQuota.quota - userQuota.totalUploadSize);
        
        return {
            quota: userQuota.quota,
            totalUploadSize: userQuota.totalUploadSize,
            remainingQuota,
            uploadCount: userQuota.uploadCount,
            usagePercentage: Math.round((userQuota.totalUploadSize / userQuota.quota) * 100),
            lastUpdated: userQuota.lastUpdated
        };
    }
}

module.exports = new UserQuotaService();
