/// <reference types="chrome" />

type ClaimLensVideoContext = {
  videoId: string;
  youtubeUrl: string;
  title?: string;
  channelName?: string;
  timestampSec?: number;
  detectedAt: string;
};

let lastContextKey = "";

sendVideoContext();
watchYouTubeNavigation();

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "CLAIMLENS_REQUEST_CONTEXT") {
    sendVideoContext(true);
  }
});

function sendVideoContext(force = false) {
  const context = getVideoContext();

  if (!context) {
    return;
  }

  const timestampBucket = Math.floor((context.timestampSec ?? 0) / 5);
  const contextKey = `${context.videoId}:${context.title ?? ""}:${context.channelName ?? ""}:${timestampBucket}`;

  if (!force && contextKey === lastContextKey) {
    return;
  }

  lastContextKey = contextKey;
  chrome.runtime.sendMessage({
    type: "CLAIMLENS_VIDEO_CONTEXT",
    payload: context,
  });
}

function getVideoContext(): ClaimLensVideoContext | null {
  const videoId = getVideoIdFromLocation();

  if (!videoId) {
    return null;
  }

  return {
    videoId,
    youtubeUrl: `https://www.youtube.com/watch?v=${videoId}`,
    title: getVideoTitle(),
    channelName: getChannelName(),
    timestampSec: getCurrentTimestamp(),
    detectedAt: new Date().toISOString(),
  };
}

function getVideoIdFromLocation(): string | null {
  const url = new URL(window.location.href);

  if (url.pathname === "/watch") {
    return normalizeVideoId(url.searchParams.get("v"));
  }

  if (url.pathname.startsWith("/shorts/")) {
    return normalizeVideoId(url.pathname.split("/")[2]);
  }

  return null;
}

function normalizeVideoId(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();

  return /^[A-Za-z0-9_-]{6,}$/.test(trimmed) ? trimmed : null;
}

function getVideoTitle(): string | undefined {
  const title = document
    .querySelector("h1 yt-formatted-string")
    ?.textContent?.trim();

  return title || document.title.replace(/ - YouTube$/, "").trim() || undefined;
}

function getChannelName(): string | undefined {
  return (
    document
      .querySelector("#owner #channel-name a, ytd-channel-name a")
      ?.textContent?.trim() || undefined
  );
}

function getCurrentTimestamp(): number | undefined {
  const video = document.querySelector("video");

  return video ? Math.floor(video.currentTime) : undefined;
}

function watchYouTubeNavigation() {
  const notifyNavigation = () => {
    window.setTimeout(() => sendVideoContext(true), 500);
  };

  const pushState = history.pushState;
  const replaceState = history.replaceState;

  history.pushState = function pushStateWithClaimLensEvent(...args) {
    const result = pushState.apply(this, args);
    notifyNavigation();
    return result;
  };

  history.replaceState = function replaceStateWithClaimLensEvent(...args) {
    const result = replaceState.apply(this, args);
    notifyNavigation();
    return result;
  };

  window.addEventListener("popstate", notifyNavigation);
  window.setInterval(() => sendVideoContext(), 2500);
}
