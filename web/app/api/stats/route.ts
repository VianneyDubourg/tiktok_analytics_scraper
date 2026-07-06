import { NextRequest, NextResponse } from "next/server";
import { fetchPublicProfile, scanUserAgents, TikTokFetchError, type Diagnostics } from "@/lib/tiktok";
import { incrementSearches } from "@/lib/redis";

export const dynamic = "force-dynamic";

// Two outbound TikTok requests happen per search, one with a retry - worst
// case comfortably exceeds Vercel's default function timeout, which was
// silently killing the video-stats fetch in production. Give it real room.
export const maxDuration = 30;

const STATUS_BY_CODE: Record<string, number> = {
  NOT_FOUND: 404,
  INVALID_HANDLE: 400,
  BLOCKED: 429,
  PARSE_FAILED: 502,
  NETWORK: 502,
};

export async function GET(request: NextRequest) {
  const handle = request.nextUrl.searchParams.get("handle") ?? "";
  // ?debug=1 surfaces the raw fetch trail (status codes, timings, errors) in
  // the JSON response itself, so a "it doesn't work in production" report can
  // be diagnosed by opening a URL - no hosting dashboard access needed.
  const debug = request.nextUrl.searchParams.get("debug") === "1";
  const diagnostics: Diagnostics | undefined = debug ? [] : undefined;

  // ?debug=1&scan=1 skips the normal lookup entirely and instead tries a
  // batch of candidate User-Agents against the same TikTok page, to find
  // out which ones (if any) aren't blocked from this deployment's IP.
  if (debug && request.nextUrl.searchParams.get("scan") === "1") {
    const scan = await scanUserAgents(handle || "tiktok");
    return NextResponse.json({ scan });
  }

  try {
    const profile = await fetchPublicProfile(handle, diagnostics);
    const searches = await incrementSearches();
    return NextResponse.json({ profile, searches, ...(debug ? { diagnostics } : {}) });
  } catch (error) {
    if (error instanceof TikTokFetchError) {
      return NextResponse.json(
        { error: error.message, code: error.code, ...(debug ? { diagnostics } : {}) },
        { status: STATUS_BY_CODE[error.code] ?? 500 }
      );
    }
    return NextResponse.json(
      { error: "Erreur inattendue.", ...(debug ? { diagnostics } : {}) },
      { status: 500 }
    );
  }
}
