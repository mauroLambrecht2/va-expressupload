# Azure Function Setup Guide

## Prerequisites
1. Azure account with student subscription
2. Node.js installed
3. Azure Functions Core Tools

## Setup Steps

### 1. Install Azure Functions Core Tools
```bash
npm install -g azure-functions-core-tools@4
```

### 2. Create Function Project
```bash
mkdir video-upload-function
cd video-upload-function
func init . --typescript
```

### 3. Create Upload Function
```bash
func new --name video-upload --template "HTTP trigger"
```

### 4. Install Dependencies
```bash
npm install @azure/storage-blob multer jsonwebtoken
npm install -D @types/multer @types/jsonwebtoken
```

### 5. Configure Environment Variables
Create `local.settings.json`:
```json
{
  "IsEncrypted": false,
  "Values": {
    "AzureWebJobsStorage": "",
    "FUNCTIONS_WORKER_RUNTIME": "node",
    "AZURE_STORAGE_CONNECTION_STRING": "your_connection_string",
    "JWT_SECRET": "your_jwt_secret",
    "RENDER_BACKEND_URL": "https://va-expressupload.onrender.com"
  }
}
```

### 6. Deploy to Azure
```bash
# Login to Azure
az login

# Create resource group
az group create --name video-upload-rg --location eastus

# Create function app
az functionapp create --resource-group video-upload-rg --consumption-plan-location eastus --runtime node --runtime-version 18 --functions-version 4 --name your-function-app-name --storage-account yourstorageaccount

# Deploy
func azure functionapp publish your-function-app-name
```
