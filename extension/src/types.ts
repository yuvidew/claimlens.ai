export type ClaimLensVideoContext = {
  videoId: string;
  youtubeUrl: string;
  title?: string;
  channelName?: string;
  timestampSec?: number;
  detectedAt: string;
};

export type RuntimeMessage =
  | {
      type: "CLAIMLENS_VIDEO_CONTEXT";
      payload: ClaimLensVideoContext;
    }
  | {
      type: "CLAIMLENS_GET_ACTIVE_CONTEXT";
    }
  | {
      type: "CLAIMLENS_REQUEST_CONTEXT";
    };
