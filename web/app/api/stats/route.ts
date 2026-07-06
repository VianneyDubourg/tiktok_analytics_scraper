import { NextRequest, NextResponse } from "next/server";
import { fetchPublicProfile, TikTokFetchError } from "@/lib/tiktok";
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

  try {
    const profile = await fetchPublicProfile(handle);
    const searches = await incrementSearches();
    return NextResponse.json({ profile, searches });
  } catch (error) {
    if (error instanceof TikTokFetchError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: STATUS_BY_CODE[error.code] ?? 500 }
      );
    }
    return NextResponse.json({ error: "Erreur inattendue." }, { status: 500 });
  }
}
