# ClaimLens AI Extension

This is the browser extension shell for ClaimLens AI. It uses Manifest V3, Vite, React, TypeScript, Tailwind CSS, and local shadcn-style UI primitives.

The current build includes:

- Popup launcher
- Chrome/Edge side panel
- YouTube content script for video detection
- Background service worker for active video context
- Tailwind/shadcn-style Button, Card, and Badge components

The AI analysis API is not connected yet.

## Build

From the project root:

```bash
npm run extension:build
```

## Load In Chrome Or Edge

1. Open `chrome://extensions` or `edge://extensions`.
2. Enable Developer mode.
3. Choose Load unpacked.
4. Select the `extension/dist` folder.
5. Click the ClaimLens AI extension icon.

The popup should detect whether the active tab is a YouTube video and can open the side panel.

## Next Step

Connect the side panel to the ClaimLens Next.js API and render mock claim analysis data.