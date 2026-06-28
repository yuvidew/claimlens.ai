# ClaimLens AI

ClaimLens AI is a browser extension and Next.js API for checking claims in YouTube videos against public evidence sources.

The product is not a lie detector. It extracts checkable claims from YouTube context/transcripts when available, searches public evidence, and returns verdicts, confidence, explanations, and source links.

## Repository Structure

```text
extension/
  public/manifest.json
  src/background.ts
  src/content-script.ts
  src/popup/main.tsx
  src/side-panel/main.tsx
  src/lib/api.ts

src/app/api/analysis/analyze-youtube-claims/route.ts
src/components/ui/
```

## How It Works

```text
YouTube watch page
  -> extension content script reads video context
  -> background worker stores active video context
  -> side panel sends analysis request
  -> Next.js API fetches transcript/caption data when available
  -> API searches evidence and asks an AI provider for structured results
  -> side panel displays claims, verdicts, confidence, and source links
```

The extension currently calls the deployed API at:

```text
https://claimlens-ai.vercel.app/api/analysis/analyze-youtube-claims
```

## Features

- Chrome/Edge Manifest V3 extension.
- YouTube video detection from the active tab.
- Side panel analysis UI.
- Analysis modes: Balanced, Deep Search, Funding Focus.
- Batched claim processing, defaulting to 5 claims per batch.
- Duplicate claim tracking for the current video.
- Current-video-only local cache in extension storage.
- Public evidence source links in each claim card.
- API provider fallback order: Gemini, Groq, then Mistral.
- Tavily evidence search when `TAVILY_API_KEY` is configured.
- Caption/transcript fallback: if captions are unavailable, the API can fall back to cautious metadata-based analysis.

## Tech Stack

- Next.js 16 App Router for the backend API.
- React 19 for the web/extension UIs.
- TypeScript across the app and extension.
- Vite for extension bundling.
- Manifest V3 for Chrome/Edge extension support.
- Tailwind CSS and local shadcn-style UI primitives.
- Recharts for report charts in the extension side panel.
- `youtube-transcript` for caption/transcript fetching.
- Tavily for public evidence search.
- Gemini, Groq, and Mistral as AI report providers.
- Biome for formatting and checks.

## Main Files

| File | Purpose |
| --- | --- |
| `extension/public/manifest.json` | Extension permissions, content scripts, side panel entry, and API host permissions. |
| `extension/src/content-script.ts` | Runs on YouTube pages, reads video ID/title/channel/current time, and sends context to the background worker. |
| `extension/src/background.ts` | Tracks active tab/video context and serves it to popup/side-panel UI. |
| `extension/src/popup/main.tsx` | Small extension popup that detects a YouTube video and opens the side panel. |
| `extension/src/side-panel/main.tsx` | Main extension experience: controls, status, batched reports, claim cards, charts, source links, and current-video cache. |
| `extension/src/lib/api.ts` | Client wrapper that calls the deployed analysis API. |
| `src/app/api/analysis/analyze-youtube-claims/route.ts` | Server-side analysis API route: validates input, fetches transcript, searches evidence, calls AI providers, normalizes reports. |
| `src/components/ui/*` | Shared UI primitives generated for the Next app. |

## Extension Data Flow

1. The user opens a YouTube watch page.
2. `content-script.ts` extracts:
   - `videoId`
   - canonical YouTube URL
   - title
   - channel name
   - current playback timestamp
3. `background.ts` stores the latest context in `chrome.storage.session` and keeps a per-tab memory map.
4. `side-panel/main.tsx` requests the active context.
5. The user clicks **Analyze this video**, or auto-analysis runs for a new 60-second segment.
6. The side panel sends the request through `extension/src/lib/api.ts`.
7. The API returns a normalized report.
8. The side panel merges the returned batch into the current report and stores only the current video's claims in `chrome.storage.local`.

## Batched Claim Analysis

The extension does not try to analyze the whole video at once. It works in batches:

- Default batch size is 5 claims.
- Each request includes `segmentStartSec` and `segmentEndSec`.
- Each returned claim gets a stable `claimKey`.
- Previously analyzed `claimKey` values are sent back to the API as `excludedClaimKeys`.
- The API filters duplicate claims before returning a batch.
- The side panel appends new unique claims to the current report.
- **Analyze next 5 claims** moves to the next 60-second segment and requests the next batch.

The extension intentionally keeps only the current video's cached report. When the active video changes, old claim data is cleared.

## API Contract

Endpoint:

```text
POST /api/analysis/analyze-youtube-claims
```

Request body:

```ts
type AnalyzeRequest = {
  youtubeUrl: string;
  videoTitle?: string;
  channelName?: string;
  currentTimeSec?: number;
  excludedClaimKeys?: string[];
  maxClaims?: number; // 1-12, defaults to 5
  searchDepth?: "balanced" | "deep" | "funding";
  segmentStartSec?: number;
  segmentEndSec?: number;
};
```

Successful response:

```ts
type AnalyzeResponse = {
  success: true;
  data: {
    overallEvidenceScore: number;
    totalClaims: number;
    totalSources: number;
    highRiskClaims: number;
    provider?: string;
    claims: Array<{
      id: string;
      timestamp: string;
      category: string;
      claim: string;
      claimKey?: string;
      verdict: "Supported" | "Mixed" | "Insufficient";
      confidence: number;
      explanation?: string;
      sources: Array<{
        title: string;
        domain: string;
        url?: string;
        reliability: "High" | "Medium" | "Low";
      }>;
    }>;
  };
};
```

Error response:

```ts
type ErrorResponse = {
  success: false;
  error: string;
};
```

## API Processing Steps

1. Validate the request with Zod.
2. Extract and validate the YouTube video ID.
3. Fetch transcript/caption entries using `youtube-transcript`.
4. Select transcript entries for the requested segment.
5. If captions are unavailable, create a cautious metadata fallback transcript from title/channel/URL/current time.
6. Build an evidence search query from video title and transcript/metadata text.
7. Search public evidence with Tavily when configured.
8. Build a strict JSON prompt for the AI provider.
9. Try providers in order: Gemini, Groq, Mistral.
10. Normalize report shape, source URLs, reliability, verdict, confidence, and claim keys.
11. Filter claims already present in `excludedClaimKeys`.
12. Return the next non-duplicate claim batch.

## Source Links

Each source can include a full `url`. If an AI provider returns only a source `domain`, the API derives a URL like `https://domain.com`. The extension shows a visible **Open source** link and the URL/domain text for each evidence source.

## Requirements

- Node.js 20 or newer recommended.
- npm.
- Chrome or Edge for loading the unpacked extension.
- API keys for at least one supported AI provider.

## Environment Variables

Create a local `.env` or `.env.local` file for development. Do not commit it.

```env
GOOGLE_API_KEY=
GEMINI_API_KEY=
GROQ_API_KEY=
MISTRAL_API_KEY=
MISTRAL_MODEL=mistral-small-2506
TAVILY_API_KEY=
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

At least one of `GOOGLE_API_KEY`/`GEMINI_API_KEY`, `GROQ_API_KEY`, or `MISTRAL_API_KEY` is needed for structured claim evaluation. `TAVILY_API_KEY` is used for evidence search.

## Install

```bash
npm install
```

## Run The Next.js API Locally

```bash
npm run dev
```

The local API runs at:

```text
http://localhost:3000/api/analysis/analyze-youtube-claims
```

The current extension build is configured for the deployed Vercel API. To use local API development, update `extension/src/lib/api.ts` and `extension/public/manifest.json`, then rebuild the extension.

For local extension API testing, change:

```ts
const apiBaseUrl = "http://localhost:3000";
```

And add this host permission in `extension/public/manifest.json`:

```json
"http://localhost:3000/*"
```

Then rebuild and reload the extension.

## Build The Extension

```bash
npm run extension:build
```

This creates the extension bundle in:

```text
extension/dist
```

## Load The Extension

1. Open `chrome://extensions` or `edge://extensions`.
2. Enable Developer mode.
3. Choose Load unpacked.
4. Select the `extension/dist` folder.
5. Open a YouTube video page.
6. Open the ClaimLens AI extension and side panel.

After every extension rebuild, reload the unpacked extension from the browser extensions page.

## API Request Example

```bash
curl -X POST https://claimlens-ai.vercel.app/api/analysis/analyze-youtube-claims \
  -H "Content-Type: application/json" \
  -d '{
    "youtubeUrl": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "videoTitle": "Test YouTube video",
    "maxClaims": 5,
    "searchDepth": "balanced",
    "segmentStartSec": 0,
    "segmentEndSec": 60,
    "excludedClaimKeys": []
  }'
```

## Scripts

```bash
npm run dev              # Start Next.js dev server
npm run build            # Build Next.js app/API
npm run start            # Start production Next.js server
npm run lint             # Run Biome checks
npm run format           # Format files with Biome
npm run extension:dev    # Run extension Vite dev build
npm run extension:build  # Build extension into extension/dist
```

## Verification

Recommended checks before pushing:

```bash
npm run build
npm run extension:build
```

For files touched during extension/API work, targeted checks are useful:

```bash
npx biome check src/app/api/analysis/analyze-youtube-claims/route.ts extension/src/lib/api.ts extension/src/side-panel/main.tsx
```

You can test the deployed API with PowerShell:

```powershell
$body = @{
  youtubeUrl = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
  videoTitle = 'Test YouTube video'
  maxClaims = 1
  searchDepth = 'balanced'
  segmentStartSec = 0
  segmentEndSec = 60
  excludedClaimKeys = @()
} | ConvertTo-Json

Invoke-WebRequest `
  -UseBasicParsing `
  -Uri 'https://claimlens-ai.vercel.app/api/analysis/analyze-youtube-claims' `
  -Method Post `
  -ContentType 'application/json' `
  -Body $body
```

## Deployment Notes

- The Next.js API is deployed to Vercel at `https://claimlens-ai.vercel.app`.
- Vercel must have the same environment variables configured as local development.
- After API changes, commit and push to `main` so Vercel can redeploy.
- After extension source changes, run `npm run extension:build` and reload the unpacked `extension/dist` extension in the browser.
- If the extension still shows old behavior after rebuilding, remove and re-add the unpacked extension or confirm it is loaded from this repo's `extension/dist` folder.

## Troubleshooting

### Extension Shows `Failed to fetch`

- Confirm `extension/src/lib/api.ts` points to the correct API base URL.
- Confirm `extension/public/manifest.json` includes the API host in `host_permissions`.
- Run `npm run extension:build`.
- Reload the extension from `chrome://extensions` or `edge://extensions`.
- Check the API preflight response:

```powershell
Invoke-WebRequest `
  -UseBasicParsing `
  -Uri 'https://claimlens-ai.vercel.app/api/analysis/analyze-youtube-claims' `
  -Method Options
```

### Extension Shows A No-Transcript Error

- Make sure the latest API fallback changes are pushed and deployed to Vercel.
- Confirm the deployed API no longer returns a hard 422 for captionless videos.
- Captions may still fail on some videos; metadata fallback is intentionally cautious.

### Extension Shows Old UI Or Old API URL

- Rebuild with `npm run extension:build`.
- Reload the unpacked extension.
- Search `extension/dist` for stale URLs:

```bash
rg "localhost:3000|claimlens-ai.vercel.app" extension/dist
```

### No Sources Appear

- Check `TAVILY_API_KEY` in the API environment.
- Some claims may not have public evidence.
- Source URLs are normalized when possible, but weak model output may still return limited source detail.

## Current Status

Implemented:

- Extension popup and side panel.
- YouTube context detection.
- Deployed analysis API call.
- Transcript fetching with metadata fallback.
- Batched claim processing.
- Current-video-only cache.
- Duplicate claim filtering.
- Evidence source cards with links.
- Production extension build.

Still to improve:

- A full `/` web app page is not currently part of the production build output.
- More robust transcript handling for videos with unavailable/blocked captions.
- Better semantic duplicate detection beyond normalized text keys.
- Background continuation across the whole video without user clicking next batch.
- More verdict categories such as Mostly Supported, Misleading, and Contradicted.
- Automated tests for API normalization, cache behavior, and extension UI state.

## Notes And Limitations

- YouTube captions/transcripts are not available for every video.
- Caption fetching can fail because of video settings, language availability, or YouTube changes.
- Metadata fallback is cautious and should not be treated the same as full transcript analysis.
- Results are evidence-based assessments, not legal, medical, financial, or truth guarantees.
- The extension stores only the current video's analyzed claims and clears old video claim data when the active video changes.

## Security

- Never commit `.env`, `.env.local`, API keys, tokens, or secrets.
- Rotate any key that was accidentally pushed or shared.
- The repository `.gitignore` ignores env files by default.
