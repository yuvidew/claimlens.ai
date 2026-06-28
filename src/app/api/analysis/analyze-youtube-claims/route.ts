import { NextResponse } from "next/server";
import { fetchTranscript } from "youtube-transcript";
import { z } from "zod";

const requestSchema = z.object({
  youtubeUrl: z.string().url(),
  videoTitle: z.string().optional(),
  channelName: z.string().optional(),
  currentTimeSec: z.coerce.number().min(0).optional(),
  excludedClaimKeys: z.array(z.string()).default([]),
  maxClaims: z.coerce.number().int().min(1).max(12).default(5),
  searchDepth: z.enum(["balanced", "deep", "funding"]).default("balanced"),
  segmentEndSec: z.coerce.number().min(0).optional(),
  segmentStartSec: z.coerce.number().min(0).optional(),
});

type Verdict = "Supported" | "Mixed" | "Insufficient";
type Reliability = "High" | "Medium" | "Low";

type EvidenceSource = {
  title: string;
  domain: string;
  url?: string;
  reliability: Reliability;
};

type ClaimResult = {
  id: string;
  timestamp: string;
  category: string;
  claim: string;
  claimKey?: string;
  verdict: Verdict;
  confidence: number;
  explanation?: string;
  sources: EvidenceSource[];
};

type AnalysisReport = {
  overallEvidenceScore: number;
  totalClaims: number;
  totalSources: number;
  highRiskClaims: number;
  claims: ClaimResult[];
  provider?: string;
};

type SearchResult = {
  title: string;
  url: string;
  content?: string;
};

type TranscriptSegment = {
  startSec: number;
  endSec: number;
  text: string;
};

const providerOrder = ["gemini", "groq", "mistral"] as const;

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(),
  });
}

export async function POST(request: Request) {
  try {
    const body = requestSchema.parse(await request.json());
    const videoId = extractYouTubeVideoId(body.youtubeUrl);

    if (!videoId) {
      return jsonResponse(
        {
          success: false,
          error: "This does not look like a valid YouTube URL.",
        },
        400,
      );
    }

    const transcriptSegments = await getTranscriptSegments(videoId);
    const selectedTranscriptSegments = selectTranscriptSegments(
      transcriptSegments,
      body.segmentStartSec,
      body.segmentEndSec,
    );

    if (selectedTranscriptSegments.length === 0) {
      return jsonResponse(
        {
          success: false,
          error:
            "No transcript was found for this video segment. Caption-based analysis is required in the MVP.",
        },
        422,
      );
    }

    const excludedClaimKeys = new Set(body.excludedClaimKeys);
    const transcriptText = formatTranscriptForPrompt(
      selectedTranscriptSegments,
    );
    const searchResults = await searchEvidence(
      buildEvidenceQuery(body.videoTitle, transcriptText),
      body.searchDepth,
    );
    const report = await generateReport({
      channelName: body.channelName,
      currentTimeSec: body.currentTimeSec,
      excludedClaimKeys,
      maxClaims: body.maxClaims,
      searchResults,
      segmentEndSec: body.segmentEndSec,
      segmentStartSec: body.segmentStartSec,
      transcriptText,
      videoTitle: body.videoTitle,
      youtubeUrl: body.youtubeUrl,
    });

    return jsonResponse({ success: true, data: report });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonResponse(
        { success: false, error: "Invalid analysis request." },
        400,
      );
    }

    return jsonResponse(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Analysis failed before a report could be created.",
      },
      500,
    );
  }
}

async function generateReport(input: {
  youtubeUrl: string;
  videoTitle?: string;
  channelName?: string;
  currentTimeSec?: number;
  excludedClaimKeys: Set<string>;
  maxClaims: number;
  searchResults: SearchResult[];
  segmentEndSec?: number;
  segmentStartSec?: number;
  transcriptText: string;
}): Promise<AnalysisReport> {
  const prompt = buildPrompt(input);
  const errors: string[] = [];

  for (const provider of providerOrder) {
    try {
      const raw = await callProvider(provider, prompt);
      const report = normalizeReport(
        parseJson(raw),
        input.searchResults,
        provider,
        input.excludedClaimKeys,
        input.maxClaims,
      );
      return report;
    } catch (error) {
      errors.push(
        `${provider}: ${error instanceof Error ? error.message : "failed"}`,
      );
    }
  }

  if (input.searchResults.length > 0) {
    return createTavilyFallbackReport(input);
  }

  if (errors.length > 0) {
    throw new Error(
      `No AI provider could generate a report and Tavily returned no sources. Check server API keys. ${errors.join(" | ")}`,
    );
  }

  throw new Error(
    "No AI provider is configured. Add provider API keys to .env.local.",
  );
}

async function callProvider(
  provider: (typeof providerOrder)[number],
  prompt: string,
) {
  if (provider === "gemini") {
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      throw new Error("missing GEMINI_API_KEY");
    }

    const model = process.env.GEMINI_MODEL || "gemini-1.5-flash";
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.2,
          },
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      },
    );

    if (!response.ok) {
      throw new Error(`Gemini request failed with ${response.status}`);
    }

    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  }

  if (provider === "groq") {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      throw new Error("missing GROQ_API_KEY");
    }

    return callOpenAiCompatible({
      apiKey,
      body: {
        messages: [{ role: "user", content: prompt }],
        model: process.env.GROQ_MODEL || "llama-3.1-8b-instant",
        response_format: { type: "json_object" },
        temperature: 0.2,
      },
      providerName: "Groq",
      url: "https://api.groq.com/openai/v1/chat/completions",
    });
  }

  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) {
    throw new Error("missing MISTRAL_API_KEY");
  }

  return callOpenAiCompatible({
    apiKey,
    body: {
      messages: [{ role: "user", content: prompt }],
      model: process.env.MISTRAL_MODEL || "mistral-small-2506",
      response_format: { type: "json_object" },
      temperature: 0.2,
    },
    providerName: "Mistral",
    url: "https://api.mistral.ai/v1/chat/completions",
  });
}

async function callOpenAiCompatible(input: {
  apiKey: string;
  body: Record<string, unknown>;
  providerName: string;
  url: string;
}) {
  const response = await fetch(input.url, {
    body: JSON.stringify(input.body),
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(
      `${input.providerName} request failed with ${response.status}`,
    );
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content ?? "";
}

function buildPrompt(input: {
  youtubeUrl: string;
  videoTitle?: string;
  channelName?: string;
  currentTimeSec?: number;
  excludedClaimKeys: Set<string>;
  maxClaims: number;
  searchResults: SearchResult[];
  segmentEndSec?: number;
  segmentStartSec?: number;
  transcriptText: string;
}) {
  const evidence = input.searchResults
    .slice(0, 8)
    .map(
      (result, index) =>
        `${index + 1}. ${result.title}\nURL: ${result.url}\nSnippet: ${result.content ?? ""}`,
    )
    .join("\n\n");

  return `You are ClaimLens AI. Build an evidence-based YouTube claim report as JSON only.

Important limits:
- Extract up to ${input.maxClaims} checkable factual claims from the transcript excerpt, not just the title.
- Do not repeat claims whose normalized claim keys are already analyzed.
- Keep timestamps aligned to the transcript line where the claim appears.
- Use only the supplied evidence snippets for verdicts.
- If evidence is weak or indirect, use "Insufficient" or "Mixed".
- Do not say anyone is lying.

Video URL: ${input.youtubeUrl}
Video title: ${input.videoTitle ?? "Unknown"}
Channel: ${input.channelName ?? "Unknown"}
Requested segment: ${formatSegmentLabel(input.segmentStartSec, input.segmentEndSec)}
Current playback time: ${typeof input.currentTimeSec === "number" ? formatTimestamp(input.currentTimeSec) : "Unknown"}
Max claims: ${input.maxClaims}
Already analyzed claim keys: ${Array.from(input.excludedClaimKeys).slice(0, 40).join(", ") || "None"}

Transcript excerpt:
${input.transcriptText}

Evidence snippets:
${evidence || "No public evidence snippets were retrieved."}

Return exactly this JSON shape:
{
  "overallEvidenceScore": number,
  "claims": [
    {
      "id": "claim-1",
      "timestamp": "00:00",
      "category": "Government",
      "claim": "Specific checkable claim",
      "verdict": "Supported" | "Mixed" | "Insufficient",
      "confidence": number,
      "explanation": "One concise sentence explaining the verdict.",
      "sources": [{ "title": "Source title", "domain": "domain.com", "url": "https://...", "reliability": "High" | "Medium" | "Low" }]
    }
  ]
}`;
}

async function getTranscriptSegments(
  videoId: string,
): Promise<TranscriptSegment[]> {
  try {
    const transcript = await fetchTranscript(videoId, { lang: "en" });
    const timingScale = transcript.some((entry) => entry.duration > 100)
      ? 1000
      : 1;

    return transcript
      .map((entry) => {
        const startSec = entry.offset / timingScale;
        const durationSec = entry.duration / timingScale;

        return {
          endSec: startSec + durationSec,
          startSec,
          text: entry.text.replace(/\s+/g, " ").trim(),
        };
      })
      .filter((entry) => entry.text.length > 0);
  } catch {
    return [];
  }
}

function selectTranscriptSegments(
  transcriptSegments: TranscriptSegment[],
  segmentStartSec?: number,
  segmentEndSec?: number,
) {
  if (
    typeof segmentStartSec !== "number" ||
    typeof segmentEndSec !== "number"
  ) {
    return transcriptSegments.slice(0, 80);
  }

  const selectedSegments = transcriptSegments.filter(
    (segment) =>
      segment.endSec >= segmentStartSec && segment.startSec <= segmentEndSec,
  );

  return selectedSegments.length > 0 ? selectedSegments : transcriptSegments;
}

function formatTranscriptForPrompt(transcriptSegments: TranscriptSegment[]) {
  const transcript = transcriptSegments
    .map((segment) => `[${formatTimestamp(segment.startSec)}] ${segment.text}`)
    .join("\n");

  return transcript.length > 5000
    ? `${transcript.slice(0, 5000)}\n[Transcript clipped for MVP analysis]`
    : transcript;
}

function buildEvidenceQuery(
  videoTitle: string | undefined,
  transcriptText: string,
) {
  const normalizedTranscript = transcriptText
    .replace(/\[[0-9:]+\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);

  return [videoTitle, normalizedTranscript].filter(Boolean).join(" ");
}

async function searchEvidence(
  query: string,
  depth: "balanced" | "deep" | "funding",
) {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    return [];
  }

  const response = await fetch("https://api.tavily.com/search", {
    body: JSON.stringify({
      api_key: apiKey,
      include_answer: false,
      max_results: depth === "deep" ? 8 : 5,
      query:
        depth === "funding"
          ? `${query} funding official announcement evidence`
          : `${query} evidence sources`,
      search_depth: depth === "deep" ? "advanced" : "basic",
    }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });

  if (!response.ok) {
    return [];
  }

  const data = await response.json();
  return (data.results ?? []).map((result: SearchResult) => ({
    content: result.content,
    title: result.title,
    url: result.url,
  }));
}

function normalizeReport(
  raw: unknown,
  searchResults: SearchResult[],
  provider: string,
  excludedClaimKeys: Set<string>,
  maxClaims: number,
): AnalysisReport {
  const value =
    typeof raw === "object" && raw !== null
      ? (raw as Partial<AnalysisReport>)
      : {};
  const claims = Array.isArray(value.claims)
    ? value.claims
        .map((claim, index) => normalizeClaim(claim, index, searchResults))
        .filter((claim) => !excludedClaimKeys.has(claim.claimKey ?? ""))
        .slice(0, maxClaims)
    : [];

  const totalSources = claims.reduce(
    (total, claim) => total + claim.sources.length,
    0,
  );

  return {
    claims,
    highRiskClaims: claims.filter((claim) => claim.verdict !== "Supported")
      .length,
    overallEvidenceScore: clampNumber(value.overallEvidenceScore, 0, 100, 55),
    provider,
    totalClaims: claims.length,
    totalSources,
  };
}

function normalizeClaim(
  raw: unknown,
  index: number,
  searchResults: SearchResult[],
): ClaimResult {
  const claim =
    typeof raw === "object" && raw !== null
      ? (raw as Partial<ClaimResult>)
      : {};
  const fallbackSources = searchResults.slice(0, 2).map(sourceFromSearchResult);
  const claimText =
    typeof claim.claim === "string"
      ? claim.claim
      : "Transcript-derived claim needs confirmation.";

  return {
    category: typeof claim.category === "string" ? claim.category : "Other",
    claim: claimText,
    claimKey: createClaimKey(claimText),
    confidence: clampNumber(claim.confidence, 0, 100, 45),
    explanation:
      typeof claim.explanation === "string" ? claim.explanation : undefined,
    id: typeof claim.id === "string" ? claim.id : `claim-${index + 1}`,
    sources:
      Array.isArray(claim.sources) && claim.sources.length > 0
        ? claim.sources.map(normalizeSource).slice(0, 4)
        : fallbackSources,
    timestamp: typeof claim.timestamp === "string" ? claim.timestamp : "00:00",
    verdict: normalizeVerdict(claim.verdict),
  };
}

function normalizeSource(raw: unknown): EvidenceSource {
  const source =
    typeof raw === "object" && raw !== null
      ? (raw as Partial<EvidenceSource>)
      : {};
  const url = typeof source.url === "string" ? source.url : undefined;
  const domain =
    typeof source.domain === "string" ? source.domain : domainFromUrl(url);

  return {
    domain,
    reliability: normalizeReliability(source.reliability),
    title: typeof source.title === "string" ? source.title : "Evidence source",
    url: url ?? urlFromDomain(domain),
  };
}

function sourceFromSearchResult(result: SearchResult): EvidenceSource {
  return {
    domain: domainFromUrl(result.url),
    reliability: classifyReliability(result.url),
    title: result.title,
    url: result.url,
  };
}

function createTavilyFallbackReport(input: {
  youtubeUrl: string;
  videoTitle?: string;
  channelName?: string;
  currentTimeSec?: number;
  excludedClaimKeys: Set<string>;
  maxClaims: number;
  searchResults: SearchResult[];
  segmentEndSec?: number;
  segmentStartSec?: number;
  transcriptText: string;
}): AnalysisReport {
  const title = input.videoTitle?.trim() || "the current YouTube video";
  const sources = input.searchResults.map(sourceFromSearchResult);
  const primarySources = sources.slice(0, 4);
  const secondarySources = sources.slice(1, 5);
  const tertiarySources = sources.slice(2, 6);
  const fallbackClaims = [
    {
      category: inferCategory(title),
      claim: `Public sources were found for the video topic: ${title}`,
      confidence: primarySources.length >= 3 ? 72 : 58,
      explanation:
        "This fallback report uses Tavily search results only because no AI provider completed the structured evaluation.",
      id: "tavily-claim-topic",
      sources: primarySources,
      timestamp: "00:00",
      verdict:
        primarySources.length >= 2
          ? ("Mixed" as const)
          : ("Insufficient" as const),
    },
    {
      category: "Source review",
      claim:
        "The available public evidence should be reviewed before treating any video claim as supported.",
      confidence: 55,
      explanation:
        "Tavily returned potentially relevant sources, but transcript-based claim extraction has not been run yet.",
      id: "tavily-claim-review",
      sources: secondarySources.length > 0 ? secondarySources : primarySources,
      timestamp: "00:00",
      verdict: "Insufficient",
    },
    {
      category: "Context",
      claim: input.channelName
        ? `The video context is associated with ${input.channelName}.`
        : "The video context needs transcript confirmation.",
      confidence: tertiarySources.length >= 2 ? 62 : 45,
      explanation:
        "This is a context-level fallback claim and should be replaced by transcript-derived claims in the full pipeline.",
      id: "tavily-claim-context",
      sources: tertiarySources.length > 0 ? tertiarySources : primarySources,
      timestamp: "00:00",
      verdict:
        tertiarySources.length >= 2
          ? ("Mixed" as const)
          : ("Insufficient" as const),
    },
  ] satisfies ClaimResult[];
  const claims = fallbackClaims
    .map((claim) => ({ ...claim, claimKey: createClaimKey(claim.claim) }))
    .filter((claim) => !input.excludedClaimKeys.has(claim.claimKey))
    .slice(0, Math.min(input.maxClaims, 3));

  const totalSources = claims.reduce(
    (total, claim) => total + claim.sources.length,
    0,
  );

  return {
    claims,
    highRiskClaims: claims.length,
    overallEvidenceScore: Math.min(74, 45 + sources.length * 5),
    provider: "tavily-fallback",
    totalClaims: claims.length,
    totalSources,
  };
}

function inferCategory(title: string) {
  const lowerTitle = title.toLowerCase();

  if (/funding|raised|series|valuation|investor/.test(lowerTitle)) {
    return "Funding";
  }

  if (/bill|sanction|government|policy|election|legal|court/.test(lowerTitle)) {
    return "Government";
  }

  if (/research|study|clinical|medical|health/.test(lowerTitle)) {
    return "Research";
  }

  return "General";
}

function createClaimKey(claim: string) {
  return claim
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180)
    .replace(/\s/g, "-");
}

function parseJson(text: string): unknown {
  const trimmed = text.trim();
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  return JSON.parse(jsonMatch ? jsonMatch[0] : trimmed);
}

function normalizeVerdict(value: unknown): Verdict {
  if (value === "Supported" || value === "Mixed" || value === "Insufficient") {
    return value;
  }

  return "Insufficient";
}

function normalizeReliability(value: unknown): Reliability {
  if (value === "High" || value === "Medium" || value === "Low") {
    return value;
  }

  return "Medium";
}

function classifyReliability(url: string): Reliability {
  const domain = domainFromUrl(url);
  if (
    /\.gov$|reuters\.com|apnews\.com|bbc\.com|ft\.com|who\.int|worldbank\.org/.test(
      domain,
    )
  ) {
    return "High";
  }

  if (/cnn\.com|cnbc\.com|techcrunch\.com|bloomberg\.com/.test(domain)) {
    return "Medium";
  }

  return "Medium";
}

function clampNumber(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
) {
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numberValue)) {
    return fallback;
  }

  const scaledValue =
    max === 100 && numberValue > 0 && numberValue <= 1
      ? numberValue * 100
      : numberValue;

  return Math.max(min, Math.min(max, Math.round(scaledValue)));
}

function domainFromUrl(url?: string) {
  if (!url) {
    return "unknown-source";
  }

  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "unknown-source";
  }
}

function urlFromDomain(domain: string) {
  return domain && domain !== "unknown-source"
    ? `https://${domain}`
    : undefined;
}

function extractYouTubeVideoId(urlString: string) {
  try {
    const url = new URL(urlString);

    if (url.hostname === "youtu.be") {
      return url.pathname.slice(1) || null;
    }

    if (url.hostname.endsWith("youtube.com") && url.pathname === "/watch") {
      return url.searchParams.get("v");
    }

    if (
      url.hostname.endsWith("youtube.com") &&
      url.pathname.startsWith("/shorts/")
    ) {
      return url.pathname.split("/")[2] || null;
    }

    return null;
  } catch {
    return null;
  }
}

function formatSegmentLabel(startSec?: number, endSec?: number) {
  if (typeof startSec !== "number" || typeof endSec !== "number") {
    return "Full available video context";
  }

  return `${formatTimestamp(startSec)}-${formatTimestamp(endSec)}`;
}

function formatTimestamp(timestampSec: number) {
  const minutes = Math.floor(timestampSec / 60)
    .toString()
    .padStart(2, "0");
  const seconds = Math.floor(timestampSec % 60)
    .toString()
    .padStart(2, "0");

  return `${minutes}:${seconds}`;
}

function jsonResponse(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: corsHeaders() });
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Origin": "*",
  };
}
