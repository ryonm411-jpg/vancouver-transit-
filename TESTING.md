# Testing Guide

## Testing the Vancouver Transit App

### Prerequisites
- Expo Go app installed on your phone ([iOS](https://apps.apple.com/app/expo-go/id982107779) | [Android](https://play.google.com/store/apps/details?id=host.exp.exponent))
- Dev server running (`npm start`)
- Phone and computer on same WiFi network

---

## Step 1: Launch the App

### Start Dev Server (if not running)
```bash
cd c:\Users\Ryon\Desktop\transit-app
npm start
```

### Connect Your Phone
1. **iOS**: Open Camera app → Scan QR code from terminal
2. **Android**: Open Expo Go app → Scan QR code

The app should load on your phone within 10-20 seconds.

---

## Step 2: Test Routine Management

### Create Your First Routine
1. **Open app** → Tap "Add New Routine" button
2. **Enter details:**
   - Name: "Morning Commute"
   - Frequency: Daily
   - Tap **+ icon** to add segment

3. **Add Transit Segment:**
   - Route Number: `99`
   - Stop Name: `Broadway & Commercial`
   - Destination: `UBC`
   - Time: `08:00` (or any time)
   - Transit Type: Select **Bus**

4. **Tap "Save"**

### Verify Routine Created
- ✅ Should see routine on Home screen
- ✅ Should show "Next Transit" if time is upcoming
- ✅ Go to Routines tab → Should see routine listed

### Test Routine Toggle
1. On Home screen, tap the **toggle switch** on routine card
2. ✅ Routine should become inactive (grayed out)
3. Toggle again to reactivate

---

## Step 3: Test Notifications

### Enable Notifications
1. Go to **Settings** tab
2. Toggle **"Push Notifications"** ON
3. **Grant permission** when prompted
4. Toggle **"Transit Monitoring"** ON
5. ✅ Status should show "Notifications: Enabled" and "Monitoring: Active"

### Send Test Notification (Dev Mode)
1. In Settings, tap **"Send Test Notification"**
2. ✅ Should receive notification on your phone
3. ✅ Notification should appear in phone's notification center
4. Go to **Notifications** tab
5. ✅ Should see test notification in history

---

## Step 4: Test Background Monitoring

### Create Time-Sensitive Routine
1. Create a new routine with time **5-10 minutes in the future**
   - Example: If it's 3:00 PM, set time to 3:05 PM
2. Enable monitoring in Settings
3. **Close the app completely** (swipe away)
4. Wait for the scheduled time
5. ✅ Should receive boarding reminder notification
6. ✅ Notification should work even with app closed

---

## Step 5: Test Notification History

### View Notifications
1. Go to **Notifications** tab
2. ✅ Should see all received notifications
3. ✅ Each notification should have:
   - Icon (color-coded by type)
   - Message text
   - Route number (if applicable)
   - Timestamp ("5m ago", "2h ago")
   - Blue dot if unread

### Refresh Notifications
1. Pull down on Notifications screen
2. ✅ Should refresh and show latest notifications

---

## Step 6: Test All Screens

### Home Screen
- ✅ Shows active routines
- ✅ "Next Transit" indicator (if applicable)
- ✅ Pull-to-refresh works
- ✅ Toggle routine active/inactive
- ✅ "Add New Routine" button works

### Routines Screen
- ✅ Shows all routines (active and inactive)
- ✅ Shows segment count
- ✅ Pull-to-refresh works
- ✅ FAB (+) button opens create screen

### Notifications Screen
- ✅ Shows notification history
- ✅ Color-coded icons
- ✅ Timestamps
- ✅ Pull-to-refresh works

### Settings Screen
- ✅ Notification toggle works
- ✅ Monitoring toggle works
- ✅ Status display accurate
- ✅ Test notification button works (dev mode)

---

## Common Issues & Solutions

### App Won't Load
```bash
# Clear cache and restart
npx expo start --clear
```

### Notifications Not Working
1. Check Settings → Notifications are enabled
2. Check phone settings → Expo Go has notification permission
3. Try test notification button

### QR Code Won't Scan
1. Ensure phone and computer on same WiFi
2. Try tunnel mode: `npx expo start --tunnel`
3. Or manually enter URL shown in terminal

### Changes Not Showing
1. Shake phone → Tap "Reload"
2. Or restart dev server

---

## Testing Checklist

Before committing, verify:
- [ ] App launches successfully
- [ ] Can create routine
- [ ] Routine appears on Home screen
- [ ] Can toggle routine active/inactive
- [ ] Notifications permission works
- [ ] Monitoring toggle works
- [ ] Test notification received
- [ ] Notification appears in history
- [ ] All 4 tabs navigate correctly
- [ ] Pull-to-refresh works on all screens
- [ ] No console errors (check terminal)

---

## Performance Testing

### Check for Errors
Watch terminal output for:
- ❌ Red error messages
- ⚠️ Yellow warnings (some are okay)
- ✅ Green success messages

### Test on Different Devices
If possible, test on:
- iOS device
- Android device
- Different screen sizes

---

## Next Steps

Once testing is complete:
1. Fix any bugs found
2. Test with real transit data (create routine for actual commute)
3. Monitor background notifications over a few days
4. Commit to GitHub (see GITHUB.md)

---

## Getting Help

If you encounter issues:
1. Check terminal for error messages
2. Check phone console (shake phone → "Show Dev Menu" → "Debug Remote JS")
3. Review TROUBLESHOOTING.md
4. Check Expo documentation: https://docs.expo.dev/
