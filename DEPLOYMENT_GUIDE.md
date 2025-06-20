# VillainArc Clip Upload - Deployment Guide

## Overview
Your app is configured for **single deployment** - the Express server serves both the API and the React frontend to the same provider, completely free forever.

## Free Forever Deployment Options

### Option 1: Render (Recommended - Free Forever)

Render offers **750 hours/month FREE** which is enough for always-on apps, and it's truly free forever.

#### Step 1: Prepare for Deployment
```bash
# Build the React app (will happen automatically on Render)
cd client
npm run build
cd ..
```

#### Step 2: Deploy to Render
1. Go to [Render](https://render.com)
2. Sign up with GitHub
3. Click "New" → "Web Service"
4. Connect your GitHub repository
5. Configure:
   - **Name**: va-clipupload (or your choice)
   - **Environment**: Node
   - **Build Command**: `npm install && cd client && npm install && cd .. && npm run build`
   - **Start Command**: `npm start`
   - **Instance Type**: Free

#### Step 3: Set Environment Variables
In Render dashboard, add these:
- `NODE_ENV=production`
- `DISCORD_WEBHOOK_URL=your_webhook_url`
- `PORT` (leave empty - Render sets this automatically)

#### Step 4: Deploy
- Render will automatically build and deploy
- You'll get a free URL: `https://va-clipupload.onrender.com`

### Option 2: Railway (Generous Free Tier)

Railway gives $5/month credit (about 500 hours) which should be enough for most community projects.

### Option 2: Railway (Generous Free Tier)

Railway gives $5/month credit (about 500 hours) which should be enough for most community projects.

1. Go to [Railway](https://railway.app)
2. Sign up with GitHub  
3. Click "New Project" → "Deploy from GitHub repo"
4. Select your repository
5. Add environment variables:
   - `NODE_ENV=production`
   - `DISCORD_WEBHOOK_URL=your_webhook_url`

### Option 3: Cyclic (Free Tier) 

Cyclic offers free hosting for Node.js apps:

1. Go to [Cyclic](https://cyclic.sh)
2. Connect GitHub and deploy
3. Set environment variables in dashboard
4. Free custom domains included

### Option 4: Fly.io (Free Allowance)

Fly.io gives free resources (3 shared CPU VMs):

```bash
# Install flyctl
# Visit https://fly.io/docs/hands-on/install-flyctl/

# Login and launch
fly auth login
fly launch

# Deploy
fly deploy
```

## Cost Comparison (Free Forever Options)

| Platform | Free Tier | Limits | Best For |
|----------|-----------|--------|----------|
| **Render** | 750 hrs/month | Sleeps after 15min idle | **Recommended** |
| Railway | $5 credit/month | ~500 hours | Good backup |
| Cyclic | Unlimited | 1GB bandwidth/day | Simple apps |
| Fly.io | 3 shared VMs | 160GB/month bandwidth | Performance |

## Recommended: Render

**Why Render is best for free forever:**
- 750 hours = 31+ days (enough for always-on)
- Sleeps after 15 minutes of inactivity (wakes up on first request)
- Perfect for community projects with occasional traffic
- Easy GitHub integration
- Custom domains included
- Good build/deploy pipeline

## Current Configuration

### Frontend (React)
- Runs on port 3000 in development
- Built to `client/build/` for production
- Served by Express in production

### Backend (Express)
- Runs on port 8000 (configurable via PORT env var)
- Serves API endpoints (`/upload`, `/video/:id`, etc.)
- Serves React app in production
- Handles file uploads to `uploads/` directory

### File Structure for Deployment
```
va-web-clipupload/
├── server.js          # Express server (entry point)
├── package.json       # Backend dependencies
├── .env              # Environment variables (NOT in git)
├── uploads/          # File storage directory
└── client/
    ├── build/        # Built React app (served by Express)
    ├── src/
    └── package.json  # Frontend dependencies
```

## Build Process

### Local Build
```bash
# From root directory
npm run build
```

### Production Build (happens automatically on deploy)
```bash
npm install          # Install backend deps
cd client && npm install  # Install frontend deps
npm run build       # Build React app
npm start          # Start Express server
```

## Environment Variables

### Required
- `NODE_ENV=production`
- `DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...`

### Optional
- `PORT=8000` (defaults to 8000, or host-provided port)
- `FRONTEND_URL=https://your-app.railway.app`
- `BACKEND_URL=https://your-app.railway.app`

## Security Notes

1. **Never commit .env file** - it's already in .gitignore
2. **Set DISCORD_WEBHOOK_URL** in deployment platform's environment variables
3. **CORS is configured** for your domain in production
4. **File validation** prevents malicious uploads
5. **Rate limiting** prevents abuse

## Post-Deployment Checklist

- [ ] App loads at your deployment URL
- [ ] File upload works
- [ ] Discord webhook sends notifications
- [ ] Videos play correctly
- [ ] Download links work
- [ ] All environment variables are set

## Troubleshooting

### Common Issues

1. **Build fails**: Check if `client/build` directory exists
2. **Upload fails**: Verify file permissions on uploads directory
3. **Discord webhook fails**: Check webhook URL format
4. **CORS errors**: Verify FRONTEND_URL and BACKEND_URL in .env

### Logs
- Railway: Check deployment logs in dashboard
- Render: View logs in service dashboard
- Local: Check console output

## Cost Comparison (Free Forever Options)

| Platform | Free Tier | Limits | Best For |
|----------|-----------|--------|----------|
| **Render** | 750 hrs/month | Sleeps after 15min idle | **Recommended** |
| Railway | $5 credit/month | ~500 hours | Good backup |
| Cyclic | Unlimited | 1GB bandwidth/day | Simple apps |
| Fly.io | 3 shared VMs | 160GB/month bandwidth | Performance |

## Recommended: Render

**Why Render is best for free forever:**
- 750 hours = 31+ days (enough for always-on)
- Sleeps after 15 minutes of inactivity (wakes up on first request)
- Perfect for community projects with occasional traffic
- Easy GitHub integration
- Custom domains included
- Good build/deploy pipeline

## Step-by-Step Render Deployment

### 1. Push to GitHub
```bash
# Make sure your code is committed and pushed
git add .
git commit -m "Ready for deployment"
git push origin main
```

### 2. Create Render Account
1. Go to [render.com](https://render.com)
2. Sign up with GitHub
3. Authorize Render to access your repositories

### 3. Deploy
1. Click "New" → "Web Service"
2. Select your repository
3. Configure:
   - **Name**: `va-clipupload`
   - **Environment**: `Node`
   - **Build Command**: `npm install && cd client && npm install && npm run build && cd ..`
   - **Start Command**: `npm start`
   - **Instance Type**: `Free`

### 4. Environment Variables
Add these in Render dashboard:
```
NODE_ENV=production
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/YOUR_WEBHOOK_ID/YOUR_TOKEN
```

### 5. Deploy & Test
- Render will build and deploy automatically
- Your app will be available at: `https://va-clipupload.onrender.com`
- First deploy takes 2-3 minutes

## Alternative: Railway Quick Deploy

If you prefer Railway:

1. Visit [railway.app](https://railway.app)
2. Sign in with GitHub
3. Click "New Project" → "Deploy from GitHub repo"
4. Select your repository
5. Add environment variables
6. Deploy! (Railway auto-detects Node.js)

## Post-Deployment Notes

- **Free tier sleeps**: App will sleep after 15 minutes of no traffic
- **Wake up time**: Takes 10-30 seconds to wake up on first request
- **Perfect for communities**: Most community tools have sporadic usage
- **Upgrade if needed**: Can always upgrade to paid tier for always-on

## Pro Tips for Free Hosting

1. **Use a uptime monitor** (like UptimeRobot) to ping your app every 14 minutes to keep it awake
2. **Optimize cold starts** - your app is already optimized for this
3. **Monitor usage** - 750 hours is generous but keep an eye on it
4. **Consider multiple platforms** - deploy to both Render and Railway as backups
