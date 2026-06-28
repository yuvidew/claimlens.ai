/// <reference types="chrome" />

import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  ExternalLink,
  FileSearch,
  Link2,
  ShieldCheck,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ModeToggle } from "../components/mode-toggle";
import { ThemeProvider } from "../components/theme-provider";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import {
  type AnalysisMode,
  analyzeYouTubeClaims,
  type ExtensionClaim,
  type ExtensionReport,
} from "../lib/api";
import type { ClaimLensVideoContext } from "../types";
import "../styles/globals.css";

const progressSteps = [
  "Reading YouTube context",
  "Preparing transcript request",
  "Ready for ClaimLens API connection",
];

const segmentLengthSec = 60;
const claimsPerPage = 2;

const verdictColors: Record<ExtensionClaim["verdict"], string> = {
  Supported: "#059669",
  Mixed: "#d97706",
  Insufficient: "#64748b",
};

const reliabilityColors: Record<
  ExtensionClaim["sources"][number]["reliability"],
  string
> = {
  High: "#059669",
  Medium: "#2563eb",
  Low: "#dc2626",
};

const analysisModes: Record<AnalysisMode, string> = {
  balanced: "Balanced",
  deep: "Deep Search",
  funding: "Funding Focus",
};

function SidePanel() {
  const reportSectionRef = useRef<HTMLDivElement | null>(null);
  const shouldScrollToReportRef = useRef(false);
  const [context, setContext] = useState<ClaimLensVideoContext | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [report, setReport] = useState<ExtensionReport | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [analysisMode, setAnalysisMode] = useState<AnalysisMode>("balanced");
  const [maxClaims, setMaxClaims] = useState(5);
  const [analyzedClaimKeys, setAnalyzedClaimKeys] = useState<string[]>([]);
  const [analyzedSegmentKeys, setAnalyzedSegmentKeys] = useState<string[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [isCacheReady, setIsCacheReady] = useState(false);
  const [lastAnalyzedSegmentStartSec, setLastAnalyzedSegmentStartSec] =
    useState<number | null>(null);
  const activeVideoId = context?.videoId;

  useEffect(() => {
    requestContext(setContext);

    const listener = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ) => {
      if (areaName !== "session") {
        return;
      }

      const nextContext = changes.latestVideoContext?.newValue;

      if (isVideoContext(nextContext)) {
        setContext(nextContext);
      }
    };

    chrome.storage.onChanged.addListener(listener);

    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);

  useEffect(() => {
    if (!activeVideoId) {
      setAnalyzedClaimKeys([]);
      setIsCacheReady(true);
      setLastAnalyzedSegmentStartSec(null);
      setReport(null);
      return;
    }

    let isDisposed = false;
    setIsCacheReady(false);

    void loadCachedAnalysis(activeVideoId).then((cachedAnalysis) => {
      if (isDisposed) {
        return;
      }

      setAnalyzedClaimKeys(cachedAnalysis.claimKeys);
      setLastAnalyzedSegmentStartSec(null);
      setReport(
        cachedAnalysis.claims.length > 0
          ? createReportFromClaims(cachedAnalysis.claims)
          : null,
      );
      setIsCacheReady(true);
    });

    return () => {
      isDisposed = true;
    };
  }, [activeVideoId]);

  const startAnalysisForContext = useCallback(
    async (
      targetContext: ClaimLensVideoContext,
      trigger: "manual" | "auto",
      segmentStartSec?: number,
    ) => {
      const segment = getSegmentBounds(
        segmentStartSec ?? targetContext.timestampSec ?? 0,
      );
      const segmentKey = getSegmentKey(targetContext.videoId, segment.startSec);

      shouldScrollToReportRef.current = trigger === "manual";
      setAnalysisError(null);
      setIsAnalyzing(true);
      setCurrentPage(1);

      if (trigger === "auto") {
        setAnalyzedSegmentKeys((keys) =>
          keys.includes(segmentKey) ? keys : [...keys, segmentKey],
        );
      }

      try {
        const nextReport = await analyzeYouTubeClaims({
          context: targetContext,
          currentTimeSec: segment.startSec,
          excludedClaimKeys: analyzedClaimKeys,
          maxClaims,
          searchDepth: analysisMode,
          segmentEndSec: segment.endSec,
          segmentStartSec: segment.startSec,
        });
        if (nextReport.claims.length === 0) {
          setAnalysisError(
            "No new non-duplicate claims were found in this batch.",
          );
          return;
        }

        const mergedReport = mergeReports(report, nextReport);
        const nextClaimKeys = getReportClaimKeys(mergedReport);

        setAnalyzedClaimKeys(nextClaimKeys);
        setLastAnalyzedSegmentStartSec(segment.startSec);
        setReport(mergedReport);
        void saveCachedAnalysis(targetContext.videoId, mergedReport.claims);
      } catch (error) {
        setAnalysisError(
          error instanceof Error
            ? error.message
            : "Analysis failed before a report could be created.",
        );
      } finally {
        setIsAnalyzing(false);
      }
    },
    [analysisMode, analyzedClaimKeys, maxClaims, report],
  );

  useEffect(() => {
    if (!context || !isCacheReady || isAnalyzing) {
      return;
    }

    const segment = getSegmentBounds(context.timestampSec ?? 0);
    const segmentKey = getSegmentKey(context.videoId, segment.startSec);

    if (analyzedSegmentKeys.includes(segmentKey)) {
      return;
    }

    void startAnalysisForContext(context, "auto");
  }, [
    analyzedSegmentKeys,
    context,
    isAnalyzing,
    isCacheReady,
    startAnalysisForContext,
  ]);

  useEffect(() => {
    if ((!report && !analysisError) || !shouldScrollToReportRef.current) {
      return;
    }

    shouldScrollToReportRef.current = false;

    requestAnimationFrame(() => {
      reportSectionRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  }, [analysisError, report]);

  const startAnalysis = () => {
    if (!context) {
      return;
    }

    void startAnalysisForContext(context, "manual");
  };

  const startNextBatchAnalysis = () => {
    if (!context) {
      return;
    }

    const nextSegmentStartSec =
      (lastAnalyzedSegmentStartSec ?? currentSegment.startSec) +
      segmentLengthSec;

    void startAnalysisForContext(context, "manual", nextSegmentStartSec);
  };

  const currentSegment = getSegmentBounds(context?.timestampSec ?? 0);

  const activeProgressSteps = isAnalyzing
    ? [
        "Reading YouTube context",
        "Checking transcript availability",
        "Extracting factual claims",
        "Searching public evidence",
        "Building evidence report",
      ]
    : report
      ? [
          "Reading YouTube context",
          "Transcript request prepared",
          "Claims generated",
          "Evidence preview ready",
        ]
      : progressSteps;

  return (
    <main className="min-h-screen bg-background p-4 text-foreground">
      <div className="mx-auto grid max-w-md gap-4">
        <header className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="grid size-11 place-items-center rounded-lg border bg-card text-sm font-bold text-primary">
              CL
            </div>
            <div>
              <p className="text-xs font-semibold uppercase text-muted-foreground">
                ClaimLens AI
              </p>
              <h1 className="text-xl font-semibold leading-tight">
                Evidence panel
              </h1>
            </div>
          </div>
          <ModeToggle />
        </header>

        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div className="grid gap-1">
                <CardTitle>Current video</CardTitle>
                <CardDescription>
                  ClaimLens reads the active YouTube tab context.
                </CardDescription>
              </div>
              <Badge variant={context ? "success" : "secondary"}>
                {context ? "Detected" : "No video"}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            {context ? (
              <VideoContextCard context={context} />
            ) : (
              <EmptyVideoState />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Analysis setup</CardTitle>
            <CardDescription>
              Each run analyzes up to {maxClaims} new non-duplicate claims.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <label
              className="grid gap-1.5 text-sm font-medium"
              htmlFor="analysis-mode"
            >
              Analysis mode
              <select
                id="analysis-mode"
                className="h-9 rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
                value={analysisMode}
                onChange={(event) =>
                  setAnalysisMode(event.currentTarget.value as AnalysisMode)
                }
              >
                {Object.entries(analysisModes).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>

            <label
              className="grid gap-1.5 text-sm font-medium"
              htmlFor="max-claims"
            >
              Max claims
              <input
                id="max-claims"
                className="h-9 rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
                value={maxClaims}
                max="12"
                min="3"
                onChange={(event) =>
                  setMaxClaims(Number(event.currentTarget.value))
                }
                type="number"
              />
            </label>

            <Button
              className="w-full"
              disabled={!context || isAnalyzing}
              type="button"
              onClick={startAnalysis}
            >
              <FileSearch />
              {isAnalyzing
                ? "Analyzing video..."
                : report
                  ? "Analyze current batch"
                  : "Analyze this video"}
            </Button>

            {report ? (
              <Button
                className="w-full"
                disabled={!context || isAnalyzing}
                type="button"
                variant="outline"
                onClick={startNextBatchAnalysis}
              >
                <ChevronRight />
                Analyze next {maxClaims} claims
              </Button>
            ) : null}

            <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/30 p-3 text-sm">
              <span className="grid gap-0.5">
                <span className="font-medium">Auto analyze while watching</span>
                <span className="text-xs text-muted-foreground">
                  Checks each new {segmentLengthSec}s segment once.
                </span>
              </span>
              <CheckCircle2 className="size-5 shrink-0 text-primary" />
            </div>

            <div className="flex items-center justify-between rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              <span>Current segment</span>
              <span className="font-semibold text-foreground">
                {formatSegmentRange(currentSegment)}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Status</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="grid gap-3">
              {activeProgressSteps.map((step, index) => (
                <li className="flex items-center gap-3 text-sm" key={step}>
                  {isAnalyzing && index === activeProgressSteps.length - 1 ? (
                    <Clock3 className="size-4 animate-pulse text-primary" />
                  ) : (
                    <CheckCircle2 className="size-4 text-emerald-600" />
                  )}
                  <span className="text-muted-foreground">{step}</span>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>

        <div className="scroll-mt-4" ref={reportSectionRef}>
          {analysisError ? (
            <AnalysisErrorState message={analysisError} />
          ) : null}
          {report ? (
            <ReportPreview
              currentPage={currentPage}
              report={report}
              setCurrentPage={setCurrentPage}
            />
          ) : (
            <EmptyReportState />
          )}
        </div>
      </div>
    </main>
  );
}

function ReportPreview({
  currentPage,
  report,
  setCurrentPage,
}: {
  currentPage: number;
  report: ExtensionReport;
  setCurrentPage: (page: number) => void;
}) {
  const verdictData = buildVerdictData(report.claims);
  const reliabilityData = buildReliabilityData(report.claims);
  const totalPages = Math.max(
    1,
    Math.ceil(report.claims.length / claimsPerPage),
  );
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const visibleClaims = report.claims.slice(
    (safeCurrentPage - 1) * claimsPerPage,
    safeCurrentPage * claimsPerPage,
  );

  return (
    <section className="grid gap-4">
      <Card className="overflow-hidden border-primary/20">
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div className="grid gap-1">
              <CardTitle>Evidence report</CardTitle>
              <CardDescription>
                Batches are appended while duplicate claims are skipped.
              </CardDescription>
            </div>
            <Badge variant="success">Ready</Badge>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="grid grid-cols-[112px_1fr] items-center gap-4 rounded-lg border bg-muted/30 p-3">
            <EvidenceScoreChart score={report.overallEvidenceScore} />
            <div className="grid gap-1">
              <p className="text-sm font-semibold">Overall evidence score</p>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Higher means the visible claims have stronger public support in
                the evidence set.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <Metric label="Claims" value={report.totalClaims} />
            <Metric label="Sources" value={report.totalSources} />
            <Metric label="Review" value={report.highRiskClaims} />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3">
        <ChartCard
          description="How the extracted claims are distributed by verdict."
          title="Verdict breakdown"
        >
          <div className="h-36 min-w-0">
            <ResponsiveContainer height="100%" width="100%">
              <BarChart
                data={verdictData}
                layout="vertical"
                margin={{ bottom: 0, left: 0, right: 8, top: 0 }}
              >
                <XAxis allowDecimals={false} hide type="number" />
                <YAxis
                  axisLine={false}
                  dataKey="name"
                  tickLine={false}
                  tickMargin={8}
                  type="category"
                  width={82}
                />
                <Tooltip cursor={{ fill: "rgba(15, 23, 42, 0.04)" }} />
                <Bar dataKey="value" radius={[0, 8, 8, 0]}>
                  {verdictData.map((entry) => (
                    <Cell fill={entry.color} key={entry.name} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>

        <ChartCard
          description="A quick scan of source quality in this report."
          title="Source reliability"
        >
          <div className="grid grid-cols-[132px_1fr] items-center gap-3">
            <div className="h-32 min-w-0">
              <ResponsiveContainer height="100%" width="100%">
                <PieChart>
                  <Pie
                    cx="50%"
                    cy="50%"
                    data={reliabilityData}
                    dataKey="value"
                    innerRadius={34}
                    outerRadius={54}
                    paddingAngle={3}
                    stroke="transparent"
                  >
                    {reliabilityData.map((entry) => (
                      <Cell fill={entry.color} key={entry.name} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="grid gap-2">
              {reliabilityData.map((entry) => (
                <div
                  className="flex items-center justify-between gap-2 text-xs"
                  key={entry.name}
                >
                  <span className="inline-flex items-center gap-2 text-muted-foreground">
                    <span
                      className="size-2.5 rounded-full"
                      style={{ background: entry.color }}
                    />
                    {entry.name}
                  </span>
                  <span className="font-semibold">{entry.value}</span>
                </div>
              ))}
            </div>
          </div>
        </ChartCard>
      </div>

      <div className="grid gap-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold">Claims</p>
            <p className="text-xs text-muted-foreground">
              Showing {visibleClaims.length} of {report.claims.length}
            </p>
          </div>
          <PaginationControls
            currentPage={safeCurrentPage}
            setCurrentPage={setCurrentPage}
            totalPages={totalPages}
          />
        </div>

        {visibleClaims.map((claim) => (
          <ClaimCard claim={claim} key={claim.id} />
        ))}

        {totalPages > 1 ? (
          <PaginationControls
            currentPage={safeCurrentPage}
            setCurrentPage={setCurrentPage}
            totalPages={totalPages}
          />
        ) : null}
      </div>
    </section>
  );
}

function PaginationControls({
  currentPage,
  setCurrentPage,
  totalPages,
}: {
  currentPage: number;
  setCurrentPage: (page: number) => void;
  totalPages: number;
}) {
  return (
    <div className="inline-flex items-center gap-2 rounded-md border bg-card p-1">
      <Button
        aria-label="Previous claims page"
        disabled={currentPage <= 1}
        size="icon"
        type="button"
        variant="ghost"
        onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
      >
        <ChevronLeft />
      </Button>
      <span className="min-w-14 text-center text-xs font-medium">
        {currentPage} / {totalPages}
      </span>
      <Button
        aria-label="Next claims page"
        disabled={currentPage >= totalPages}
        size="icon"
        type="button"
        variant="ghost"
        onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
      >
        <ChevronRight />
      </Button>
    </div>
  );
}

function EvidenceScoreChart({ score }: { score: number }) {
  const data = [
    { name: "Score", value: score, color: "#059669" },
    { name: "Remaining", value: 100 - score, color: "#e2e8f0" },
  ];

  return (
    <div className="relative h-28 min-w-0">
      <ResponsiveContainer height="100%" width="100%">
        <PieChart>
          <Pie
            cx="50%"
            cy="50%"
            data={data}
            dataKey="value"
            endAngle={-270}
            innerRadius={38}
            outerRadius={52}
            startAngle={90}
            stroke="transparent"
          >
            {data.map((entry) => (
              <Cell fill={entry.color} key={entry.name} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <p className="text-2xl font-semibold leading-none">{score}%</p>
          <p className="text-[10px] font-medium uppercase text-muted-foreground">
            score
          </p>
        </div>
      </div>
    </div>
  );
}

function ChartCard({
  children,
  description,
  title,
}: {
  children: React.ReactNode;
  description: string;
  title: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="grid gap-1 rounded-md border bg-muted/30 p-3 text-center">
      <span className="text-lg font-semibold leading-none">{value}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

function ClaimCard({ claim }: { claim: ExtensionClaim }) {
  const verdictVariant =
    claim.verdict === "Supported"
      ? "success"
      : claim.verdict === "Mixed"
        ? "warning"
        : "secondary";

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="grid gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{claim.timestamp}</Badge>
              <Badge variant="secondary">{claim.category}</Badge>
            </div>
            <CardTitle className="text-sm">{claim.claim}</CardTitle>
          </div>
          <Badge variant={verdictVariant}>{claim.verdict}</Badge>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3">
        <ConfidenceBar value={claim.confidence} verdict={claim.verdict} />

        {claim.explanation ? (
          <p className="rounded-md border bg-muted/20 p-3 text-xs leading-relaxed text-muted-foreground">
            {claim.explanation}
          </p>
        ) : null}

        <div className="grid gap-2">
          {claim.sources.map((source) => {
            const sourceUrl = getSourceUrl(source);

            return (
              <div
                className="grid gap-2 rounded-md border bg-background p-3"
                key={`${claim.id}-${source.domain}-${source.title}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium leading-snug">
                    {source.title}
                  </p>
                  <Badge
                    variant={
                      source.reliability === "High" ? "success" : "outline"
                    }
                  >
                    {source.reliability}
                  </Badge>
                </div>
                {sourceUrl ? (
                  <a
                    className="inline-flex w-fit items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium text-primary underline-offset-4 hover:bg-muted hover:underline"
                    href={sourceUrl}
                    rel="noreferrer"
                    target="_blank"
                  >
                    <ExternalLink className="size-3" />
                    Open source
                  </a>
                ) : null}
                <p className="break-all text-xs text-muted-foreground">
                  {sourceUrl ?? source.domain}
                </p>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function ConfidenceBar({
  value,
  verdict,
}: {
  value: number;
  verdict: ExtensionClaim["verdict"];
}) {
  return (
    <div className="grid gap-2 rounded-md bg-muted/40 px-3 py-2">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">Confidence</span>
        <span className="font-semibold">{value}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-border">
        <div
          className="h-full rounded-full transition-all"
          style={{
            background: verdictColors[verdict],
            width: `${value}%`,
          }}
        />
      </div>
    </div>
  );
}

function EmptyReportState() {
  return (
    <Card className="bg-muted/40">
      <CardHeader>
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-4 text-primary" />
          <CardTitle>Claim report will appear here</CardTitle>
        </div>
        <CardDescription>
          Click Analyze this video to render the first claim batch in this
          panel.
        </CardDescription>
      </CardHeader>
    </Card>
  );
}

function AnalysisErrorState({ message }: { message: string }) {
  return (
    <Card className="mb-4 border-destructive/30 bg-destructive/5">
      <CardHeader>
        <div className="flex items-center gap-2">
          <AlertTriangle className="size-4 text-destructive" />
          <CardTitle>Analysis could not finish</CardTitle>
        </div>
        <CardDescription>{message}</CardDescription>
      </CardHeader>
    </Card>
  );
}

function VideoContextCard({ context }: { context: ClaimLensVideoContext }) {
  return (
    <div className="grid gap-2">
      <h2 className="text-base font-semibold leading-snug">
        {context.title || "YouTube video detected"}
      </h2>
      {context.channelName ? (
        <p className="text-sm text-muted-foreground">{context.channelName}</p>
      ) : null}
      <a
        className="inline-flex items-center gap-1 text-xs font-semibold text-primary underline-offset-4 hover:underline"
        href={context.youtubeUrl}
        rel="noreferrer"
        target="_blank"
      >
        <Link2 className="size-3" />
        {context.videoId}
      </a>
    </div>
  );
}

function EmptyVideoState() {
  return (
    <div className="grid gap-2 rounded-md border border-dashed bg-muted/30 p-4">
      <h2 className="text-sm font-semibold">No YouTube video detected</h2>
      <p className="text-sm leading-relaxed text-muted-foreground">
        Open a YouTube watch page, then reopen this panel.
      </p>
    </div>
  );
}

function requestContext(
  setContext: (context: ClaimLensVideoContext | null) => void,
) {
  chrome.runtime.sendMessage(
    { type: "CLAIMLENS_GET_ACTIVE_CONTEXT" },
    (response?: { context?: ClaimLensVideoContext | null }) => {
      setContext(response?.context ?? null);
    },
  );
}

function isVideoContext(value: unknown): value is ClaimLensVideoContext {
  return (
    typeof value === "object" &&
    value !== null &&
    "videoId" in value &&
    "youtubeUrl" in value &&
    "detectedAt" in value
  );
}

type CachedAnalysis = {
  claimKeys: string[];
  claims: ExtensionClaim[];
};

function loadCachedAnalysis(videoId: string): Promise<CachedAnalysis> {
  return new Promise((resolve) => {
    chrome.storage.local.get(getAnalysisCacheKey(videoId), (result) => {
      const value = result[getAnalysisCacheKey(videoId)] as
        | Partial<CachedAnalysis>
        | undefined;

      resolve({
        claimKeys: Array.isArray(value?.claimKeys) ? value.claimKeys : [],
        claims: Array.isArray(value?.claims) ? value.claims : [],
      });
    });
  });
}

function saveCachedAnalysis(videoId: string, claims: ExtensionClaim[]) {
  const claimKeys = claims.map(getClaimKey);

  return chrome.storage.local.set({
    [getAnalysisCacheKey(videoId)]: { claimKeys, claims },
  });
}

function getAnalysisCacheKey(videoId: string) {
  return `claimlens:analysis:${videoId}`;
}

function mergeReports(
  currentReport: ExtensionReport | null,
  nextReport: ExtensionReport,
): ExtensionReport {
  const claimsByKey = new Map<string, ExtensionClaim>();

  for (const claim of currentReport?.claims ?? []) {
    claimsByKey.set(getClaimKey(claim), claim);
  }

  for (const claim of nextReport.claims) {
    claimsByKey.set(getClaimKey(claim), claim);
  }

  return createReportFromClaims([...claimsByKey.values()], nextReport.provider);
}

function createReportFromClaims(
  claims: ExtensionClaim[],
  provider?: string,
): ExtensionReport {
  const totalSources = claims.reduce(
    (total, claim) => total + claim.sources.length,
    0,
  );
  const overallEvidenceScore =
    claims.length > 0
      ? Math.round(
          claims.reduce((total, claim) => total + claim.confidence, 0) /
            claims.length,
        )
      : 0;

  return {
    claims,
    highRiskClaims: claims.filter((claim) => claim.verdict !== "Supported")
      .length,
    overallEvidenceScore,
    provider,
    totalClaims: claims.length,
    totalSources,
  };
}

function getReportClaimKeys(report: ExtensionReport) {
  return report.claims.map(getClaimKey);
}

function getClaimKey(claim: ExtensionClaim) {
  return claim.claimKey ?? createClaimKey(claim.claim);
}

function getSourceUrl(source: ExtensionClaim["sources"][number]) {
  if (source.url) {
    return source.url;
  }

  return source.domain && source.domain !== "unknown-source"
    ? `https://${source.domain}`
    : undefined;
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

function buildVerdictData(claims: ExtensionClaim[]) {
  return (["Supported", "Mixed", "Insufficient"] as const).map((name) => ({
    name,
    value: claims.filter((claim) => claim.verdict === name).length,
    color: verdictColors[name],
  }));
}

function buildReliabilityData(claims: ExtensionClaim[]) {
  const sources = claims.flatMap((claim) => claim.sources);

  return (["High", "Medium", "Low"] as const)
    .map((name) => ({
      name,
      value: sources.filter((source) => source.reliability === name).length,
      color: reliabilityColors[name],
    }))
    .filter((entry) => entry.value > 0);
}

function formatTimestamp(timestampSec: number): string {
  const minutes = Math.floor(timestampSec / 60)
    .toString()
    .padStart(2, "0");
  const seconds = Math.floor(timestampSec % 60)
    .toString()
    .padStart(2, "0");

  return `${minutes}:${seconds}`;
}

function getSegmentBounds(timestampSec: number) {
  const startSec =
    Math.floor(timestampSec / segmentLengthSec) * segmentLengthSec;

  return {
    endSec: startSec + segmentLengthSec,
    startSec,
  };
}

function getSegmentKey(videoId: string, segmentStartSec: number) {
  return `${videoId}:${segmentStartSec}`;
}

function formatSegmentRange(segment: { startSec: number; endSec: number }) {
  return `${formatTimestamp(segment.startSec)}-${formatTimestamp(segment.endSec)}`;
}

const root = document.querySelector("#root");

if (root) {
  createRoot(root).render(
    <ThemeProvider>
      <SidePanel />
    </ThemeProvider>,
  );
}
