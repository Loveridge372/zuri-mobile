# Zuri Elegance Mobile

Expo / React Native customer app for Zuri Elegance.

## Run locally

```powershell
npm install --install-links=false
$env:EXPO_NO_TELEMETRY='1'
$env:EXPO_NO_DEPENDENCY_VALIDATION='1'
npx expo start --lan
```

Then open the QR code with Expo Go on your phone.

This app is pinned to Expo SDK 54 so it can run in the current iOS Expo Go app.

## Current MVP

- Login and register
- Product browsing
- Local cart with backend cart sync
- Paystack checkout handoff
- Payment verification after returning to the app
- Orders and profile screens

## API

The app currently points to:

```text
https://zuri-elegance-api.onrender.com
```

Update `API_BASE` in `App.js` if your Render backend URL changes.
