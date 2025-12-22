# GitHub Guide

## Committing Your Vancouver Transit App to GitHub

### Prerequisites
- Git installed on your computer
- GitHub account
- Repository created (or will create new one)

---

## Step 1: Check Git Status

First, let's see what files have changed:

```bash
cd c:\Users\Ryon\Desktop\transit-app
git status
```

You should see all the new files we created.

---

## Step 2: Add Files to Git

### Add All Files
```bash
git add .
```

### Or Add Specific Files
```bash
# Add source code
git add src/
git add app/

# Add configuration
git add package.json
git add app.json
git add babel.config.js
git add tsconfig.json

# Add documentation
git add README.md
git add SETUP.md
git add TESTING.md
git add TROUBLESHOOTING.md
git add FIREBASE_SETUP.md
```

### Verify Files Added
```bash
git status
```

Should show files in green (staged for commit).

---

## Step 3: Commit Your Changes

### Create Commit
```bash
git commit -m "Implement Vancouver Transit App - Phases 1-3

- Phase 1: Project setup with Expo, Firebase, and TransLink API
- Phase 2: Routine management with Firestore CRUD operations
- Phase 3: Real-time monitoring with background service and notifications

Features:
- Create and manage transit routines (daily/weekly)
- Background monitoring service for delay detection
- Push notifications for delays and boarding reminders
- Notification history with Firestore integration
- Settings screen with monitoring toggle
- 4 main screens with tab navigation

Tech Stack:
- React Native with Expo Router
- Firebase (Firestore, Auth, Cloud Messaging)
- TransLink GTFS-RT API integration
- TypeScript
- Expo Task Manager for background tasks"
```

---

## Step 4: Create GitHub Repository (if needed)

### Option A: Create New Repository on GitHub

1. Go to [github.com](https://github.com)
2. Click **"+"** → **"New repository"**
3. Name: `vancouver-transit-app`
4. Description: "Mobile app for tracking Vancouver transit routines with real-time delay notifications"
5. **Don't** initialize with README (we already have one)
6. Click **"Create repository"**

### Option B: Use Existing Repository

If you already have a repository, skip to Step 5.

---

## Step 5: Connect to GitHub

### Add Remote (for new repository)
```bash
git remote add origin https://github.com/YOUR_USERNAME/vancouver-transit-app.git
```

Replace `YOUR_USERNAME` with your GitHub username.

### Verify Remote
```bash
git remote -v
```

Should show:
```
origin  https://github.com/YOUR_USERNAME/vancouver-transit-app.git (fetch)
origin  https://github.com/YOUR_USERNAME/vancouver-transit-app.git (push)
```

---

## Step 6: Push to GitHub

### Push to Main Branch
```bash
git push -u origin main
```

Or if your default branch is `master`:
```bash
git push -u origin master
```

### First Time Push
If this is your first push, you may need to:

1. **Set up authentication:**
   - Use GitHub CLI: `gh auth login`
   - Or use Personal Access Token
   - Or use SSH key

2. **Enter credentials** when prompted

---

## Step 7: Verify on GitHub

1. Go to your repository on GitHub
2. ✅ Should see all files uploaded
3. ✅ README.md should display on main page
4. ✅ Commit message should be visible

---

## Important: Protect Sensitive Data

### Files to Keep Private

Your repository already has `.gitignore` which excludes:
- ✅ `google-services.json` (Firebase Android config)
- ✅ `GoogleService-Info.plist` (Firebase iOS config)
- ✅ `.env` files (environment variables)
- ✅ `node_modules/` (dependencies)

### Check .gitignore
```bash
cat .gitignore
```

Should include:
```
# Firebase
google-services.json
GoogleService-Info.plist

# Environment
.env
.env*.local
```

### If Sensitive Files Were Committed

If you accidentally committed sensitive files:

```bash
# Remove from Git (keeps local file)
git rm --cached google-services.json
git rm --cached GoogleService-Info.plist

# Commit the removal
git commit -m "Remove sensitive Firebase config files"

# Push changes
git push
```

---

## Step 8: Update README (Optional)

Add setup instructions for others:

```bash
# Edit README.md
# Add section about Firebase setup
# Add section about TransLink API key
```

Then commit and push:
```bash
git add README.md
git commit -m "Update README with setup instructions"
git push
```

---

## Future Commits

### Make Changes
1. Edit files
2. Test changes
3. Add files: `git add .`
4. Commit: `git commit -m "Description of changes"`
5. Push: `git push`

### Good Commit Messages
```bash
# Good examples:
git commit -m "Add route suggestion algorithm"
git commit -m "Fix notification timing issue"
git commit -m "Update UI for better accessibility"

# Bad examples:
git commit -m "updates"
git commit -m "fix"
git commit -m "changes"
```

---

## Branching Strategy (Optional)

### Create Feature Branch
```bash
# Create and switch to new branch
git checkout -b feature/route-suggestions

# Make changes...

# Commit changes
git add .
git commit -m "Implement route suggestion algorithm"

# Push branch
git push -u origin feature/route-suggestions
```

### Merge to Main
```bash
# Switch to main
git checkout main

# Merge feature branch
git merge feature/route-suggestions

# Push to GitHub
git push
```

---

## Common Git Commands

```bash
# Check status
git status

# View commit history
git log --oneline

# View changes
git diff

# Undo uncommitted changes
git checkout -- filename

# View remote URL
git remote -v

# Pull latest changes
git pull

# Create new branch
git checkout -b branch-name

# Switch branches
git checkout branch-name

# Delete branch
git branch -d branch-name
```

---

## GitHub Repository Settings

### Recommended Settings

1. **Add Description**
   - "Mobile app for Vancouver transit with real-time delay notifications"

2. **Add Topics**
   - `react-native`
   - `expo`
   - `firebase`
   - `transit`
   - `vancouver`
   - `typescript`

3. **Add README Badges** (optional)
   ```markdown
   ![Expo](https://img.shields.io/badge/Expo-52.0.0-blue)
   ![React Native](https://img.shields.io/badge/React%20Native-0.76.5-blue)
   ![TypeScript](https://img.shields.io/badge/TypeScript-5.3.3-blue)
   ```

---

## Collaboration (Optional)

### Add Collaborators
1. Go to repository → Settings → Collaborators
2. Add team members by username/email

### Pull Requests
1. Create feature branch
2. Push to GitHub
3. Create Pull Request on GitHub
4. Review and merge

---

## Backup & Security

### Regular Backups
- GitHub serves as your backup
- Push regularly: `git push`
- Don't lose local changes

### Security Best Practices
- ✅ Never commit API keys in code
- ✅ Use `.gitignore` for sensitive files
- ✅ Use environment variables
- ✅ Review commits before pushing

---

## Summary

**Quick Workflow:**
```bash
# 1. Check status
git status

# 2. Add files
git add .

# 3. Commit
git commit -m "Your message here"

# 4. Push
git push
```

**Your repository is now on GitHub!** 🎉

You can share it, collaborate, and access it from anywhere.
