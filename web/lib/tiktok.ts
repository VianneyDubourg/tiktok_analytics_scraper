/* eslint-disable @typescript-eslint/no-explicit-any */
// The `any`s below are unavoidable: this parses TikTok's undocumented,
// unstable embedded JSON, not a typed API response.
import type { PublicProfileStats, PublicVideoStats } from "@/types";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export type TikTokErrorCode = "NOT_FOUND" | "BLOCKED" | "PARSE_FAILED" | "NETWORK" | "INVALID_HANDLE";

export class TikTokFetchError extends Error {
  code: TikTokErrorCode;

  constructor(message: string, code: TikTokErrorCode) {
    super(message);
    this.code = code;
  }
}

/** Accepts "@user", "user", or a full profile URL and returns the bare handle. */
export function normalizeHandle(raw: string): string {
  return raw
    .trim()
    .replace(/^https?:\/\/(www\.)?tiktok\.com\//i, "")
    .replace(/^@/, "")
    .split(/[/?#]/)[0]
    .trim();
}

/**
 * Fetches a TikTok profile's *public* page and extracts profile + recent
 * video stats from the server-rendered JSON TikTok embeds for SEO.
 *
 * No login, no Playwright: this is a plain HTTP GET. TikTok has shipped two
 * different embed formats over the years (`__UNIVERSAL_DATA_FOR_REHYDRATION__`
 * and the older `SIGI_STATE`); both are tried, in order, before giving up.
 * If TikTok changes the shape again, update the two `parse*` functions below
 * — everything else in the app is unaffected.
 *
 * Known limitation: only the videos embedded in the initial page load are
 * returned (typically the ~30 most recent). Older videos would require
 * TikTok's signed internal pagination API, which isn't reachable without a
 * full browser session.
 */
export async function fetchPublicProfile(rawHandle: string): Promise<PublicProfileStats> {
  const handle = normalizeHandle(rawHandle);
  if (!handle || !/^[\w.-]{1,64}$/.test(handle)) {
    throw new TikTokFetchError("Identifiant TikTok invalide.", "INVALID_HANDLE");
  }

  let response: Response;
  try {
    response = await fetch(`https://www.tiktok.com/@${encodeURIComponent(handle)}`, {
      headers: {
        "User-Agent": USER_AGENT,
        "Accept-Language": "en-US,en;q=0.9,fr;q=0.8",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      cache: "no-store",
    });
  } catch {
    throw new TikTokFetchError("Impossible de contacter TikTok pour le moment.", "NETWORK");
  }

  if (response.status === 404) {
    throw new TikTokFetchError(`Compte "@${handle}" introuvable.`, "NOT_FOUND");
  }
  if (!response.ok) {
    throw new TikTokFetchError(
      "TikTok a refusé la requête (limite de trafic probable). Réessayez dans quelques minutes.",
      "BLOCKED"
    );
  }

  const html = await response.text();

  if (isExplicitlyNotFound(html)) {
    throw new TikTokFetchError(`Compte "@${handle}" introuvable ou indisponible.`, "NOT_FOUND");
  }

  const parsed = parseUniversalData(html) ?? parseSigiState(html);

  if (!parsed) {
    if (/verify to continue|captcha/i.test(html)) {
      throw new TikTokFetchError(
        "TikTok demande une vérification anti-robot pour cette requête. Réessayez plus tard.",
        "BLOCKED"
      );
    }
    throw new TikTokFetchError(
      "Format de page TikTok non reconnu : l'interface a probablement changé.",
      "PARSE_FAILED"
    );
  }
  return parsed;
}

/**
 * TikTok answers unknown/banned/private handles with HTTP 200 and a page
 * whose embedded state carries a nonzero `statusCode` (observed: 10221,
 * "user banned") instead of any user info. Detected explicitly so it isn't
 * misreported as an anti-bot block by the generic fallback below.
 */
function isExplicitlyNotFound(html: string): boolean {
  const data = extractScriptJson(html, "__UNIVERSAL_DATA_FOR_REHYDRATION__");
  const scope = data?.__DEFAULT_SCOPE__?.["webapp.user-detail"];
  if (!scope) return false;
  return Boolean(scope.statusCode) && !scope.userInfo?.user;
}

function extractScriptJson(html: string, id: string): any | null {
  const match = html.match(new RegExp(`<script[^>]*id=["']${id}["'][^>]*>([\\s\\S]*?)</script>`));
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) {
    return Number(value);
  }
  return null;
}

function mapVideoItem(item: any): PublicVideoStats | null {
  if (!item?.id) return null;
  const stats = item.stats ?? item.statsV2 ?? {};
  const author = typeof item.author === "string" ? item.author : item.author?.uniqueId;
  return {
    id: String(item.id),
    description: item.desc ?? "",
    url: author ? `https://www.tiktok.com/@${author}/video/${item.id}` : "",
    createTime: toNumber(item.createTime),
    durationSeconds: toNumber(item.video?.duration),
    cover: item.video?.cover ?? item.video?.originCover ?? item.video?.dynamicCover ?? "",
    views: toNumber(stats.playCount),
    likes: toNumber(stats.diggCount),
    comments: toNumber(stats.commentCount),
    shares: toNumber(stats.shareCount),
    saves: toNumber(stats.collectCount),
  };
}

function parseUniversalData(html: string): PublicProfileStats | null {
  const data = extractScriptJson(html, "__UNIVERSAL_DATA_FOR_REHYDRATION__");
  const scope = data?.__DEFAULT_SCOPE__?.["webapp.user-detail"];
  const user = scope?.userInfo?.user;
  if (!user) return null;
  const stats = scope?.userInfo?.stats ?? scope?.userInfo?.statsV2 ?? {};
  const items: any[] = Array.isArray(scope?.itemList) ? scope.itemList : [];

  return buildProfile(user, stats, items);
}

function parseSigiState(html: string): PublicProfileStats | null {
  const data = extractScriptJson(html, "SIGI_STATE");
  const users = data?.UserModule?.users ?? {};
  const statsMap = data?.UserModule?.stats ?? {};
  const handleKey = Object.keys(users)[0];
  const user = handleKey ? users[handleKey] : null;
  if (!user) return null;
  const stats = handleKey ? statsMap[handleKey] ?? {} : {};
  const items: any[] = Object.values(data?.ItemModule ?? {});

  return buildProfile(user, stats, items);
}

function buildProfile(user: any, stats: any, items: any[]): PublicProfileStats {
  return {
    handle: user.uniqueId ?? "",
    nickname: user.nickname || user.uniqueId || "",
    avatar: user.avatarLarger ?? user.avatarMedium ?? user.avatarThumb ?? "",
    bio: user.signature ?? "",
    verified: Boolean(user.verified),
    followers: toNumber(stats.followerCount),
    following: toNumber(stats.followingCount),
    totalLikes: toNumber(stats.heartCount ?? stats.heart),
    videoCount: toNumber(stats.videoCount),
    videos: items
      .map(mapVideoItem)
      .filter((video): video is PublicVideoStats => video !== null)
      .sort((a, b) => (b.createTime ?? 0) - (a.createTime ?? 0)),
  };
}
