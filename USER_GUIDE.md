# Vancouver Transit App - User Guide

## 🚀 Getting Started

### 1. Run the App
Since you already have the development server running:
1.  **Open Expo Go** on your phone.
2.  **Scan the QR Code** displayed in your terminal.
    -   *Note: Ensure your phone and computer are on the same Wi-Fi.*

---

## 📱 How to Use the Features

### 1. Create Your First Routine
*Goal: Tell the app your regular commute.*

1.  Tap **"Add New Routine"** on the Home screen.
2.  **Name:** Enter "Work Commute" (or similar).
3.  **Frequency:** Select "Daily" or specific days.
4.  **Add Segment:**
    -   Tap the **(+)** button.
    -   **Route:** Enter `99` (or your bus number).
    -   **Stop:** Enter the stop name.
    -   **Time:** Set your usual departure time.
5.  Tap **"Save"**.
    -   *You should now see your routine on the Home screen!*

### 2. Enable Smart Monitoring
*Goal: Let the app watch for delays for you.*

1.  Go to the **Settings** tab.
2.  Toggle **"Push Notifications"** → ON.
    -   *Grant permission when prompted.*
3.  Toggle **"Transit Monitoring"** → ON.
    -   *The app is now running in the background.*

### 3. Try "Smart Suggestions" (Simulation)
*Goal: See what happens when a bus is delayed.*

1.  Create a routine for **Route 99** scheduled for **5-10 minutes from now**.
2.  Close the app (swipe it away).
3.  Wait ~2 minutes.
4.  **Result:** You will get a notification saying the 99 is delayed and suggesting Route 84 instead.
    -   *Note: This uses simulated data for testing purposes.*

### 4. Help with Tracking (Optional)
*Goal: Contribute to crowdsourced accuracy.*

1.  In **Settings**, toggle **"Location Tracking"** → ON.
2.  Select **"Allow Always"** when asked for location permissions.
    -   *This allows the app to track bus speed/location while you ride.*

---

## 🛠️ Troubleshooting

-   **App won't load?**
    -   Shake your phone and tap "Reload".
    -   Or run `npx expo start --clear` in your terminal.
-   **No notifications?**
    -   Check your phone's main Settings app → Notifications → Expo Go.
    -   Ensure "Allow Notifications" is ON.

## 📦 Saving Your Work

When you are happy with the app, don't forget to save your code changes:

```bash
git add .
git commit -m "Complete Phases 4 and 5: Smart Suggestions and Location Tracking"
git push
```
