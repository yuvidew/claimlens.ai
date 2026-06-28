import type { ClaimLensVideoContext } from "../types";

export type AnalysisMode = "balanced" | "deep" | "funding";

export type ExtensionClaim = {
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
};

export type ExtensionReport = {
  overallEvidenceScore: number;
  totalClaims: number;
  totalSources: number;
  highRiskClaims: number;
  provider?: string;
  claims: ExtensionClaim[];
};

type ApiResponse =
  | { success: true; data: ExtensionReport }
  | { success: false; error: string };

const apiBaseUrl = "https://claimlens-ai.vercel.app";

export async function analyzeYouTubeClaims(input: {
  context: ClaimLensVideoContext;
  currentTimeSec?: number;
  excludedClaimKeys?: string[];
  maxClaims: number;
  searchDepth: AnalysisMode;
  segmentEndSec?: number;
  segmentStartSec?: number;
}) {
  const response = await fetch(
    `${apiBaseUrl}/api/analysis/analyze-youtube-claims`,
    {
      body: JSON.stringify({
        channelName: input.context.channelName,
        currentTimeSec: input.currentTimeSec,
        excludedClaimKeys: input.excludedClaimKeys ?? [],
        maxClaims: input.maxClaims,
        searchDepth: input.searchDepth,
        segmentEndSec: input.segmentEndSec,
        segmentStartSec: input.segmentStartSec,
        videoTitle: input.context.title,
        youtubeUrl: input.context.youtubeUrl,
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    },
  );

  const data = (await response.json()) as ApiResponse;

  if (!response.ok || !data.success) {
    throw new Error(data.success ? "Analysis failed." : data.error);
  }

  return data.data;
}
