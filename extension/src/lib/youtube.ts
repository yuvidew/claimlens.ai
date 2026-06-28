export function extractYouTubeVideoId(urlString: string): string | null {
  try {
    const url = new URL(urlString);

    if (url.hostname === "youtu.be") {
      return normalizeVideoId(url.pathname.slice(1));
    }

    if (!url.hostname.endsWith("youtube.com")) {
      return null;
    }

    if (url.pathname === "/watch") {
      return normalizeVideoId(url.searchParams.get("v"));
    }

    if (url.pathname.startsWith("/shorts/")) {
      return normalizeVideoId(url.pathname.split("/")[2]);
    }

    return null;
  } catch {
    return null;
  }
}

export function toCanonicalYouTubeUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

function normalizeVideoId(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();

  return /^[A-Za-z0-9_-]{6,}$/.test(trimmed) ? trimmed : null;
}
