const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { BlobSASPermissions, generateBlobSASQueryParameters } = require('@azure/storage-blob');
const { getBlobServiceClient, getSharedKeyCredential } = require('../config/azure');
const config = require('../config');
const router = express.Router();

// Middleware: requireAuth (replace with your actual auth middleware)
const { requireAuth } = require('../middleware/auth');

// POST /api/generate-sas-url
router.post('/generate-sas-url', requireAuth, async (req, res) => {
  try {
    const { filename, filesize } = req.body;
    if (!filename || !filesize) {
      return res.status(400).json({ error: 'Missing filename or filesize' });
    }
    if (filesize > 500 * 1024 * 1024) {
      return res.status(400).json({ error: 'File size exceeds 500MB limit' });
    }

    // Check user quota before issuing SAS URL
    const userQuotaService = require('../services/userQuotaService');
    const userId = req.user.id;
    const canUpload = await userQuotaService.canUserUpload(userId, filesize);
    if (!canUpload) {
      return res.status(403).json({ error: 'Insufficient quota for this upload.' });
    }

    const blobServiceClient = getBlobServiceClient();
    const sharedKeyCredential = getSharedKeyCredential();
    const containerName = config.azure.containerName;
    const blobName = `${uuidv4()}-${filename}`;
    const containerClient = blobServiceClient.getContainerClient(containerName);
    const blobClient = containerClient.getBlockBlobClient(blobName);

    // Generate SAS token for write (upload) access
    const expiresOn = new Date(Date.now() + 15 * 60 * 1000); // 15 min expiry
    const sas = generateBlobSASQueryParameters({
      containerName,
      blobName,
      permissions: BlobSASPermissions.parse('cw'), // create, write
      expiresOn
    }, sharedKeyCredential).toString();

    const sasUrl = `${blobClient.url}?${sas}`;
    res.json({ sasUrl, blobName });
  } catch (error) {
    console.error('Failed to generate SAS URL:', error);
    res.status(500).json({ error: 'Failed to generate SAS URL' });
  }
});

module.exports = router;
