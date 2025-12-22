# Troubleshooting App Startup

The app is currently failing to start. Here are steps to debug and fix the issue.

## Error

```
Error in startAsync.ts:99:3
```

## Possible Causes

1. **Expo Router Configuration** - Missing or incorrect setup
2. **TypeScript Configuration** - Incompatible tsconfig
3. **Firebase Initialization** - Error during Firebase setup
4. **Missing Dependencies** - Expo packages not installed correctly

## Troubleshooting Steps

### Step 1: Verify Dependencies

```bash
cd c:\Users\Ryon\Desktop\transit-app
npm install
```

### Step 2: Install Expo Dependencies

```bash
npx expo install expo-router react-native-safe-area-context react-native-screens
```

### Step 3: Clear Metro Cache

```bash
npx expo start --clear
```

### Step 4: Check for Specific Error

Run the app and look for the full error message:

```bash
npx expo start
```

Look for lines that say:
- "Error:"
- "Failed to..."
- "Cannot find module..."

### Step 5: Test Without Firebase

Temporarily disable Firebase to isolate the issue:

1. Open `app/_layout.tsx`
2. Comment out Firebase import:
```typescript
// import '../src/config/firebase'; // Initialize Firebase
```
3. Try starting the app again

### Step 6: Verify File Structure

Make sure these files exist:
- ✅ `index.js` (entry point)
- ✅ `app/_layout.tsx` (root layout)
- ✅ `app/(tabs)/_layout.tsx` (tab layout)
- ✅ `app/(tabs)/index.tsx` (home screen)
- ✅ `tsconfig.json` (TypeScript config)

### Step 7: Check Expo Version

```bash
npx expo --version
```

Should be 52.x.x or higher.

### Step 8: Reinstall Node Modules

```bash
rm -rf node_modules package-lock.json
npm install
```

### Step 9: Check for Syntax Errors

Look for TypeScript errors in the code:
```bash
npx tsc --noEmit
```

## Common Fixes

### Fix 1: Update Expo

```bash
npm install expo@latest
npx expo install --fix
```

### Fix 2: Fix TypeScript Config

Update `tsconfig.json`:
```json
{
  "extends": "expo/tsconfig.base",
  "compilerOptions": {
    "strict": true
  }
}
```

### Fix 3: Simplify Entry Point

Update `package.json`:
```json
{
  "main": "index.js"
}
```

### Fix 4: Check Babel Config

Verify `babel.config.js`:
```javascript
module.exports = function(api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
  };
};
```

## Getting Help

If none of these steps work, please:

1. Run `npx expo start` and copy the FULL error message
2. Check the Expo documentation: https://docs.expo.dev/router/installation/
3. Search for the error on Expo forums: https://forums.expo.dev/

## Alternative: Start Fresh

If all else fails, you can create a new Expo Router app and copy the code:

```bash
npx create-expo-app@latest new-transit-app --template tabs
cd new-transit-app
# Copy src/ folder from old app
# Copy app/ screens one by one
# Copy config files
```

This ensures a clean Expo Router setup.
