/// <reference types="chrome" />

import type { ClaimLensVideoContext, RuntimeMessage } from "./types";

const videoContexts = new Map<number, ClaimLensVideoContext>();
let activeTabId: number | undefined;

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel
    ?.setPanelBehavior?.({ openPanelOnActionClick: false })
    .catch(() => undefined);
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  activeTabId = tabId;
  requestVideoContext(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab.url?.includes("youtube.com")) {
    activeTabId = tabId;
    requestVideoContext(tabId);
  }
});

chrome.runtime.onMessage.addListener(
  (message: RuntimeMessage, sender, sendResponse) => {
    if (message.type === "CLAIMLENS_VIDEO_CONTEXT" && sender.tab?.id) {
      videoContexts.set(sender.tab.id, message.payload);
      chrome.storage.session?.set({ latestVideoContext: message.payload });
      sendResponse({ ok: true });
      return false;
    }

    if (message.type === "CLAIMLENS_GET_ACTIVE_CONTEXT") {
      sendLatestContext(sendResponse);
      return true;
    }

    return false;
  },
);

function sendLatestContext(
  sendResponse: (response: { context: ClaimLensVideoContext | null }) => void,
) {
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    const tabId = tab?.id ?? activeTabId;
    const context = tabId ? videoContexts.get(tabId) : undefined;

    sendResponse({ context: context ?? null });
  });
}

function requestVideoContext(tabId: number) {
  chrome.tabs
    .sendMessage(tabId, { type: "CLAIMLENS_REQUEST_CONTEXT" })
    .catch(() => undefined);
}
