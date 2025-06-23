import { AzureFunction, Context, HttpRequest } from "@azure/functions";
import { BlobServiceClient } from "@azure/storage-blob";
import * as jwt from "jsonwebtoken";
import * as crypto from "crypto";

interface User {
  id: string;
  username: string;
  quota: number;
  totalUploadSize: number;
}

const httpTrigger: AzureFunction = async (context: Context, req: HttpRequest): Promise<void> => {
  try {
    // Validate authentication
    const user = validateUser(req.headers.authorization);
    
    // Get file from request
    const file = req.body; // Assuming multipart form data is parsed
    
    if (!file) {
      context.res = {
        status: 400,
        body: { error: "No file provided" }
      };
      return;
    }

    // Check file size against quota
    const remainingQuota = user.quota - user.totalUploadSize;
    if (file.size > remainingQuota) {
      context.res = {
        status: 413,
        body: { error: "File size exceeds quota" }
      };
      return;
    }

    // Upload to Azure Blob Storage
    const result = await uploadToBlobStorage(file, user, context);
    
    // Notify Render backend of completion
    await notifyRenderBackend(result, user);

    context.res = {
      status: 200,
      body: {
        success: true,
        videoId: result.videoId,
        shareLink: result.shareLink,
        downloadUrl: result.downloadUrl
      }
    };

  } catch (error) {
    context.log.error("Upload failed:", error);
    context.res = {
      status: 500,
      body: { error: error.message }
    };
  }
};

const validateUser = (authHeader: string): User => {
  if (!authHeader) throw new Error("No authorization header");
  
  const token = authHeader.replace("Bearer ", "");
  const decoded = jwt.verify(token, process.env.JWT_SECRET) as User;
  
  return decoded;
};

const uploadToBlobStorage = async (file: any, user: User, context: Context) => {
  const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
  const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
  
  const containerName = "videos";
  const containerClient = blobServiceClient.getContainerClient(containerName);
  
  // Generate unique filename
  const videoId = crypto.randomUUID();
  const extension = file.originalname.split('.').pop();
  const blobName = `${videoId}.${extension}`;
  
  const blockBlobClient = containerClient.getBlockBlobClient(blobName);
  
  // Upload with progress tracking
  const uploadOptions = {
    blobHTTPHeaders: {
      blobContentType: file.mimetype
    },
    onProgress: (progress) => {
      context.log(`Upload progress: ${(progress.loadedBytes / file.size * 100).toFixed(1)}%`);
    }
  };
  
  await blockBlobClient.upload(file.buffer, file.size, uploadOptions);
  
  const baseUrl = process.env.RENDER_BACKEND_URL;
  
  return {
    videoId,
    blobName,
    shareLink: `${baseUrl}/v/${videoId}`,
    downloadUrl: `${baseUrl}/download/${videoId}`,
    size: file.size,
    originalName: file.originalname,
    contentType: file.mimetype
  };
};

const notifyRenderBackend = async (result: any, user: User) => {
  const renderUrl = process.env.RENDER_BACKEND_URL;
  
  await fetch(`${renderUrl}/api/upload-complete`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${jwt.sign({ id: user.id }, process.env.JWT_SECRET)}`
    },
    body: JSON.stringify({
      userId: user.id,
      uploadData: result
    })
  });
};

export default httpTrigger;
