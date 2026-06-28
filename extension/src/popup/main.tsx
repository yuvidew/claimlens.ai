/// <reference types="chrome" />

import { ExternalLink, PanelRightOpen } from "lucide-react";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
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
import { extractYouTubeVideoId } from "../lib/youtube";
import "../styles/globals.css";

function Popup() {
  const [activeUrl, setActiveUrl] = useState<string | null>(null);
  const [status, setStatus] = useState("Checking active tab...");

  useEffect(() => {
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      const url = tab?.url ?? null;
      const videoId = url ? extractYouTubeVideoId(url) : null;

      setActiveUrl(url);
      setStatus(
        videoId
          ? "YouTube video detected. Open the side panel to start."
          : "Open a YouTube video page to analyze claims.",
      );
    });
  }, []);

  const openSidePanel = () => {
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      if (!tab?.windowId) {
        setStatus("No active browser window was found.");
        return;
      }

      chrome.sidePanel
        .open({ windowId: tab.windowId })
        .then(() => setStatus("Side panel opened."))
        .catch(() => setStatus("Could not open the side panel."));
    });
  };

  const isYouTubeVideo = activeUrl
    ? Boolean(extractYouTubeVideoId(activeUrl))
    : false;

  return (
    <main className="grid w-90 gap-4 bg-background p-4 text-foreground">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-lg border bg-card text-sm font-bold text-primary">
            CL
          </div>
          <div>
            <p className="text-xs font-semibold uppercase text-muted-foreground">
              ClaimLens AI
            </p>
            <h1 className="text-lg font-semibold leading-tight">
              YouTube claim analysis
            </h1>
          </div>
        </div>
        <ModeToggle />
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div className="grid gap-1">
              <CardTitle>Extension shell</CardTitle>
              <CardDescription>
                Ready for the ClaimLens analysis API connection.
              </CardDescription>
            </div>
            <Badge variant={isYouTubeVideo ? "success" : "secondary"}>
              {isYouTubeVideo ? "Video" : "Waiting"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="flex items-start gap-2 rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
            <ExternalLink className="mt-0.5 size-4 shrink-0" />
            <span>{status}</span>
          </div>

          {activeUrl ? (
            <p className="max-h-12 overflow-hidden text-xs leading-relaxed text-muted-foreground break-anywhere">
              {activeUrl}
            </p>
          ) : null}

          <Button className="w-full" type="button" onClick={openSidePanel}>
            <PanelRightOpen />
            Open side panel
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}

const root = document.querySelector("#root");

if (root) {
  createRoot(root).render(
    <ThemeProvider>
      <Popup />
    </ThemeProvider>,
  );
}
