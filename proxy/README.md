# Proxy Server Deployment Guide

## Quick Deploy to Railway (Recommended)

1. **Create Railway Account**: Go to [railway.app](https://railway.app) and sign up with GitHub

2. **Deploy the proxy folder**:
   - Click "New Project" → "Deploy from GitHub repo"  
   - Select your transit-app repository
   - In the settings, set **Root Directory** to `proxy`

3. **Get your URL**: After deploy, Railway gives you a URL like `https://your-app.up.railway.app`

4. **Update config.ts** with your Railway URL:
   ```typescript
   export const translinkConfig = {
       apiKey: "chW7YWFXZeKGiBfEJnYD",
       baseUrl: "https://your-app.up.railway.app/api",
       gtfsRtUrl: "https://your-app.up.railway.app/gtfs"
   };
   ```

---

## Alternative: Deploy to Render (Free)

1. Go to [render.com](https://render.com) and sign up
2. Click "New" → "Web Service"
3. Connect your GitHub repo
4. Set:
   - **Root Directory**: `proxy`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
5. Get your URL and update config.ts

---

## Local Development

When developing locally on the same network:
```
node proxy-server.js
```
Use `http://192.168.x.x:3001` in config.ts (your local IP)
