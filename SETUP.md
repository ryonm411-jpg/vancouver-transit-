# Setup Guide

## 1. Install Dependencies

Run the following command to install all required packages:

```bash
npm install
```

## 2. Configure Firebase

### Create Firebase Project
1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Click "Add project"
3. Name it "Vancouver Transit App"
4. Enable Google Analytics (optional)

### Enable Firebase Services
1. **Authentication**: 
   - Go to Authentication → Get Started
   - Enable Email/Password sign-in method

2. **Firestore Database**:
   - Go to Firestore Database → Create database
   - Start in test mode (change to production rules later)
   - Choose a location (us-west2 for Vancouver)

3. **Cloud Messaging**:
   - Go to Project Settings → Cloud Messaging
   - Enable Cloud Messaging API

### Get Firebase Configuration
1. Go to Project Settings → General
2. Scroll to "Your apps" section
3. Click "Add app" → Web (</>) icon
4. Register app with nickname "Vancouver Transit Web"
5. Copy the configuration object
6. Update `src/config/config.ts` with your Firebase config

### Download Google Services Files
**For Android:**
1. Add Android app in Firebase Console
2. Package name: `com.vancouvertransit.app`
3. Download `google-services.json`
4. Place in project root

**For iOS:**
1. Add iOS app in Firebase Console
2. Bundle ID: `com.vancouvertransit.app`
3. Download `GoogleService-Info.plist`
4. Place in project root

## 3. Configure TransLink API

### Register for API Access
1. Visit [TransLink App Developer Resources](https://www.translink.ca/about-us/doing-business-with-translink/app-developer-resources)
2. Register for an API key
3. Accept terms and conditions
4. Wait for approval (usually 1-2 business days)

### Update Configuration
Once you receive your API key:
1. Open `src/config/config.ts`
2. Replace `YOUR_TRANSLINK_API_KEY` with your actual key
3. Save the file

## 4. Run the App

### Start Development Server
```bash
npm start
```

### Run on Device
1. Install **Expo Go** app on your phone:
   - [iOS App Store](https://apps.apple.com/app/expo-go/id982107779)
   - [Google Play Store](https://play.google.com/store/apps/details?id=host.exp.exponent)

2. Scan the QR code displayed in terminal with:
   - iOS: Camera app
   - Android: Expo Go app

### Run on Emulator
**Android:**
```bash
npm run android
```

**iOS (Mac only):**
```bash
npm run ios
```

## 5. Testing Notifications

### Request Permissions
1. Open the app
2. Go to Settings tab
3. Enable "Push Notifications"
4. Grant permission when prompted

### Test Notifications
The notification service is ready to use. You can test it by:
1. Creating a routine (once implemented)
2. Waiting for scheduled boarding reminder
3. Simulating a delay (for development)

## 6. Firestore Security Rules

Once you're ready for production, update Firestore security rules:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Users can only read/write their own data
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
    
    // Users can only access their own routines
    match /routines/{routineId} {
      allow read, write: if request.auth != null && 
        resource.data.userId == request.auth.uid;
    }
    
    // Users can only access their own notifications
    match /notifications/{notificationId} {
      allow read, write: if request.auth != null && 
        resource.data.userId == request.auth.uid;
    }
  }
}
```

## 7. Environment Variables (Optional)

For better security, create a `.env` file:

```env
FIREBASE_API_KEY=your_api_key
FIREBASE_AUTH_DOMAIN=your_auth_domain
FIREBASE_PROJECT_ID=your_project_id
TRANSLINK_API_KEY=your_translink_key
```

Then update `config.ts` to use environment variables.

## Troubleshooting

### "Module not found" errors
```bash
npm install
npx expo start --clear
```

### Expo Go connection issues
- Ensure phone and computer are on same WiFi network
- Try using tunnel mode: `npx expo start --tunnel`

### Firebase initialization errors
- Double-check Firebase config in `config.ts`
- Ensure `google-services.json` is in project root
- Verify Firebase services are enabled in console

### TransLink API errors
- Verify API key is correct
- Check if API key is activated
- Ensure you're using GTFS-RT V3 endpoints

## Next Steps

Once setup is complete:
1. ✅ Test the app launches successfully
2. ✅ Verify navigation between tabs works
3. ✅ Test notification permissions
4. 🔄 Implement routine creation UI
5. 🔄 Connect to Firebase Firestore
6. 🔄 Integrate TransLink real-time data
7. 🔄 Build delay detection logic
8. 🔄 Implement route suggestions

Happy coding! 🚌
