/* eslint-disable @typescript-eslint/no-explicit-any */
// The `any`s below are unavoidable: this parses TikTok's undocumented,
// unstable embedded JSON, not a typed API response.
import type { PublicProfileStats, PublicVideoStats } from "@/types";

const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// TikTok serves profile pages differently to clients identifying as a known
// search-engine crawler: a lighter, SEO-oriented HTML with schema.org
// JSON-LD (`ItemList`) that includes full per-video stats (views, likes,
// comments, shares, saves). This is the same public data TikTok deliberately
// exposes for Google to index and show in search results — just a different
// rendering path of the same public page, not an authenticated or private
// endpoint. It's what lets this app show per-video stats at all, now that
// the regular browser-facing HTML no longer embeds the video list (see
// below). Caveat: TikTok could start verifying crawler identity by IP/reverse
// DNS instead of trusting the User-Agent string, which would silently stop
// this working; that's a risk to keep in mind, not something to route
// around further.
const CRAWLER_USER_AGENT = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";

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
 * video stats. No login, no Playwright: two plain HTTP GETs run in
 * parallel:
 *
 * 1. A normal browser request, parsed for profile-level stats (followers,
 *    following, total likes, video count) via TikTok's own embedded
 *    rehydration JSON (`__UNIVERSAL_DATA_FOR_REHYDRATION__`, falling back to
 *    the older `SIGI_STATE` format). This request also used to carry the
 *    video list, but TikTok has since emptied that field for every account
 *    tested (`itemList` is always `[]`, `SIGI_STATE` sometimes isn't even
 *    served anymore) — kept only as a fallback in case that ever changes.
 * 2. A crawler-flagged request (see `CRAWLER_USER_AGENT` above), parsed for
 *    the `ItemList` JSON-LD block, which is what actually supplies
 *    per-video stats today.
 *
 * The video fetch is best-effort: if it fails or TikTok changes that page
 * too, the profile-level stats above still return successfully with an
 * empty video list rather than failing the whole lookup.
 *
 * If TikTok changes any of these shapes, update the relevant `parse*` /
 * `mapJsonLdVideo` function below — everything else in the app is
 * unaffected.
 *
 * Known limitation: the crawler page only lists a handful of videos
 * (observed: 9, consistently, across very different accounts) — an SEO
 * snippet, not the full catalog. There is no way to page through more
 * without TikTok's signed internal pagination API, which requires a full
 * browser session to compute.
 */
export async function fetchPublicProfile(rawHandle: string): Promise<PublicProfileStats> {
  const handle = normalizeHandle(rawHandle);
  if (!handle || !/^[\w.-]{1,64}$/.test(handle)) {
    throw new TikTokFetchError("Identifiant TikTok invalide.", "INVALID_HANDLE");
  }

  const [profile, videos] = await Promise.all([
    fetchProfilePage(handle),
    fetchCrawlerVideoList(handle),
  ]);

  if (videos.length > 0) {
    profile.videos = videos;
  }
  return profile;
}

async function fetchProfilePage(handle: string): Promise<PublicProfileStats> {
  let response: Response;
  try {
    response = await fetch(`https://www.tiktok.com/@${encodeURIComponent(handle)}`, {
      headers: {
        "User-Agent": BROWSER_USER_AGENT,
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

/** Best-effort: never throws, resolves to [] on any failure. */
async function fetchCrawlerVideoList(handle: string): Promise<PublicVideoStats[]> {
  try {
    const response = await fetch(`https://www.tiktok.com/@${encodeURIComponent(handle)}`, {
      headers: {
        "User-Agent": CRAWLER_USER_AGENT,
        "Accept-Language": "en-US,en;q=0.9",
      },
      cache: "no-store",
    });
    if (!response.ok) return [];

    const html = await response.text();
    const data = extractScriptJson(html, "ItemList");
    const items: any[] = Array.isArray(data?.itemListElement) ? data.itemListElement : [];

    return items
      .map(mapJsonLdVideo)
      .filter((video): video is PublicVideoStats => video !== null)
      .sort((a, b) => (b.createTime ?? 0) - (a.createTime ?? 0));
  } catch {
    return [];
  }
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

/** Parses an ISO-8601 duration ("PT27S", "PT1M5S") into whole seconds. */
function parseIsoDuration(iso: unknown): number | null {
  if (typeof iso !== "string") return null;
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(iso);
  if (!match) return null;
  const [, hours, minutes, seconds] = match;
  return Math.round(Number(hours ?? 0) * 3600 + Number(minutes ?? 0) * 60 + Number(seconds ?? 0));
}

function jsonLdInteractionCount(item: any, action: string): number | null {
  const stats: any[] = Array.isArray(item?.interactionStatistic) ? item.interactionStatistic : [];
  const entry = stats.find((stat) => stat?.interactionType?.["@type"]?.endsWith(action));
  return entry ? toNumber(entry.userInteractionCount) : null;
}

function mapJsonLdVideo(item: any): PublicVideoStats | null {
  const url = typeof item?.url === "string" ? item.url : "";
  const idMatch = url.match(/\/video\/(\d+)/);
  if (!idMatch) return null;

  return {
    id: idMatch[1],
    description: item.description || item.name || "",
    url,
    createTime: typeof item.uploadDate === "string" ? Math.floor(Date.parse(item.uploadDate) / 1000) || null : null,
    durationSeconds: parseIsoDuration(item.duration),
    cover: Array.isArray(item.thumbnailUrl) ? item.thumbnailUrl[0] ?? "" : item.thumbnailUrl ?? "",
    views: jsonLdInteractionCount(item, "WatchAction"),
    likes: jsonLdInteractionCount(item, "LikeAction"),
    comments: toNumber(item.commentCount),
    shares: jsonLdInteractionCount(item, "ShareAction"),
    saves: jsonLdInteractionCount(item, "SaveAction"),
  };
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
  const items: any[] = Array.isArray(scope?.userInfo?.itemList) ? scope.userInfo.itemList : [];

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
