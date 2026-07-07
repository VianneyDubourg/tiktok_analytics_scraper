/* eslint-disable @typescript-eslint/no-explicit-any */
// The `any`s below are unavoidable: this parses TikTok's undocumented,
// unstable embedded JSON, not a typed API response.
import { ProxyAgent, fetch as undiciFetch } from "undici";
import type { RequestInit as UndiciRequestInit, Response as UndiciResponse } from "undici";
import type { PublicProfileStats, PublicVideoStats } from "@/types";

// Confirmed in production (Vercel, iad1): TikTok returns an instant HTTP 403
// for the crawler-flagged request specifically when it originates from
// Vercel's IP ranges - almost certainly verifying Googlebot's claimed
// identity against Google's published IP list, which Vercel obviously isn't
// in. Every other well-known bot UA gets served the *plain* page (no
// ItemList) rather than being blocked, so there's no alternative UA to fall
// back to - only the network path can change. If TIKTOK_PROXY_URL is set
// (a standard `http://user:pass@host:port` proxy endpoint - ScraperAPI,
// ScrapingBee, Zenrows, Bright Data, Smartproxy, etc. all expose one), only
// the crawler-flagged request is routed through it; profile-level stats
// already work fine directly and shouldn't spend proxy quota.
let crawlerProxyAgent: ProxyAgent | null | undefined;
function getCrawlerProxyAgent(): ProxyAgent | null {
  if (crawlerProxyAgent !== undefined) return crawlerProxyAgent;
  const proxyUrl = process.env.TIKTOK_PROXY_URL;
  crawlerProxyAgent = proxyUrl
    ? new ProxyAgent({
        uri: proxyUrl,
        // Confirmed in production: this class of scraping proxy terminates
        // TLS itself and presents its own certificate rather than passing a
        // transparent CONNECT tunnel through to TikTok, which Node's default
        // trust store rejects ("unable to verify the first certificate").
        // We've already deliberately routed this request through a paid
        // third party we trust to relay it; the only thing flowing through
        // here is a public TikTok profile page, nothing sensitive - so
        // accepting their intercepting cert is a reasonable, narrowly scoped
        // trade-off rather than a real security regression.
        requestTls: { rejectUnauthorized: false },
      })
    : null;
  return crawlerProxyAgent;
}

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

// Candidates for a one-off diagnostic scan (see scanUserAgents below) after
// confirming in production that CRAWLER_USER_AGENT gets an instant HTTP 403
// from Vercel's IPs - the working theory being that TikTok verifies
// Googlebot's claimed identity against Google's published IP ranges (which
// Vercel's obviously isn't in), but may not apply the same rigor to every
// other well-known bot identity.
const USER_AGENT_CANDIDATES: Record<string, string> = {
  googlebot: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  bingbot: "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
  facebook: "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
  twitter: "Twitterbot/1.0",
  slack: "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
  discord: "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)",
  whatsapp: "WhatsApp/2.23.20.0 A",
  telegram: "TelegramBot (like TwitterBot)",
  plainBrowser: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
};

export interface UserAgentScanResult {
  name: string;
  status?: number;
  ok?: boolean;
  durationMs: number;
  itemListEntries?: number;
  error?: string;
}

/**
 * One-off diagnostic: try every candidate User-Agent above against a real
 * profile page and report status + whether it got the ItemList JSON-LD.
 * Not part of the normal request path - only invoked via ?debug=1&scan=1.
 */
export async function scanUserAgents(handle: string): Promise<UserAgentScanResult[]> {
  const results: UserAgentScanResult[] = [];
  for (const [name, userAgent] of Object.entries(USER_AGENT_CANDIDATES)) {
    const startedAt = Date.now();
    try {
      const response = await fetchWithTimeout(
        `https://www.tiktok.com/@${encodeURIComponent(handle)}`,
        { headers: { "User-Agent": userAgent, "Accept-Language": "en-US,en;q=0.9" }, cache: "no-store" },
        7000
      );
      const durationMs = Date.now() - startedAt;
      if (!response.ok) {
        results.push({ name, status: response.status, ok: false, durationMs });
        continue;
      }
      const html = await response.text();
      const data = extractScriptJson(html, "ItemList");
      const entries = Array.isArray(data?.itemListElement) ? data.itemListElement.length : 0;
      results.push({ name, status: response.status, ok: true, durationMs, itemListEntries: entries });
    } catch (error) {
      results.push({
        name,
        durationMs: Date.now() - startedAt,
        error: describeError(error),
      });
    }
  }
  return results;
}

/**
 * Optional diagnostic trail for `?debug=1` requests (see app/api/stats).
 * Lets a report of "it doesn't work in production" be diagnosed from the
 * JSON response itself - no need to dig through a hosting dashboard's log
 * viewer, which isn't accessible to everyone.
 */
export interface DiagnosticEntry {
  label: "profile" | "crawler";
  attempt: number;
  status?: number;
  ok?: boolean;
  durationMs: number;
  error?: string;
  note?: string;
  viaProxy?: boolean;
}
export type Diagnostics = DiagnosticEntry[];

export class TikTokFetchError extends Error {
  code: TikTokErrorCode;

  constructor(message: string, code: TikTokErrorCode) {
    super(message);
    this.code = code;
  }
}

/**
 * `TypeError: fetch failed` alone is useless - undici/Node wraps the real
 * reason (DNS failure, connection refused, bad proxy auth, TLS error...) in
 * `error.cause`, which gets silently dropped by a plain `${error.message}`.
 * Surfacing it is what makes a proxy misconfiguration diagnosable from the
 * `?debug=1` JSON alone, without needing another round trip.
 */
function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = (error as Error & { cause?: unknown }).cause;
  const causeText =
    cause instanceof Error
      ? ` (cause: ${cause.name}: ${cause.message})`
      : cause !== undefined
        ? ` (cause: ${String(cause)})`
        : "";
  return `${error.name}: ${error.message}${causeText}`;
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
export async function fetchPublicProfile(
  rawHandle: string,
  diagnostics?: Diagnostics
): Promise<PublicProfileStats> {
  const handle = normalizeHandle(rawHandle);
  if (!handle || !/^[\w.-]{1,64}$/.test(handle)) {
    throw new TikTokFetchError("Invalid TikTok handle.", "INVALID_HANDLE");
  }

  const [profile, videos] = await Promise.all([
    fetchProfilePage(handle, diagnostics),
    fetchCrawlerVideoList(handle, diagnostics),
  ]);

  if (videos.length > 0) {
    profile.videos = videos;
  }
  return profile;
}

/**
 * Vercel silently kills a serverless function that overruns its execution
 * budget, which previously showed up as "video fetch mysteriously fails in
 * production but works fine locally" with zero logging to explain why.
 * Every outbound TikTok request now has its own timeout (so a stalled
 * request can't eat the whole function budget) and logs on failure.
 */
async function fetchWithTimeout(
  url: string,
  init: UndiciRequestInit,
  timeoutMs: number
): Promise<UndiciResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // undiciFetch (not the Node global) so the optional `dispatcher` option
    // (proxy routing) is guaranteed to be understood the same way in every
    // runtime this ends up deployed to.
    return await undiciFetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchProfilePage(handle: string, diagnostics?: Diagnostics): Promise<PublicProfileStats> {
  const startedAt = Date.now();
  let response: UndiciResponse;
  try {
    response = await fetchWithTimeout(
      `https://www.tiktok.com/@${encodeURIComponent(handle)}`,
      {
        headers: {
          "User-Agent": BROWSER_USER_AGENT,
          "Accept-Language": "en-US,en;q=0.9,fr;q=0.8",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
        cache: "no-store",
      },
      8000
    );
    diagnostics?.push({
      label: "profile",
      attempt: 1,
      status: response.status,
      ok: response.ok,
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    console.error(`[tiktok] profile fetch failed for @${handle}:`, error);
    diagnostics?.push({
      label: "profile",
      attempt: 1,
      durationMs: Date.now() - startedAt,
      error: describeError(error),
    });
    throw new TikTokFetchError("Couldn't reach TikTok right now.", "NETWORK");
  }

  if (response.status === 404) {
    throw new TikTokFetchError(`Account "@${handle}" not found.`, "NOT_FOUND");
  }
  if (!response.ok) {
    throw new TikTokFetchError(
      "TikTok refused the request (likely rate-limited). Try again in a few minutes.",
      "BLOCKED"
    );
  }

  const html = await response.text();

  if (isExplicitlyNotFound(html)) {
    throw new TikTokFetchError(`Account "@${handle}" not found or unavailable.`, "NOT_FOUND");
  }

  const parsed = parseUniversalData(html) ?? parseSigiState(html);

  if (!parsed) {
    if (/verify to continue|captcha/i.test(html)) {
      throw new TikTokFetchError(
        "TikTok is asking for anti-bot verification on this request. Try again later.",
        "BLOCKED"
      );
    }
    throw new TikTokFetchError(
      "Unrecognized TikTok page format: their interface probably changed.",
      "PARSE_FAILED"
    );
  }
  return parsed;
}

/**
 * Best-effort: never throws, resolves to [] if every attempt fails. TikTok's
 * anti-bot layer occasionally rejects a single request transiently (observed
 * in testing), so this retries once after a short delay before giving up -
 * cheap insurance against a spurious "unavailable" for the user. Every
 * failure is logged with the reason, since this used to fail silently and
 * was impossible to diagnose from Vercel's production logs.
 */
async function fetchCrawlerVideoList(handle: string, diagnostics?: Diagnostics): Promise<PublicVideoStats[]> {
  const proxyAgent = getCrawlerProxyAgent();
  // A proxied request adds real hops (observed: timing out well past 7s on a
  // free-tier scraping proxy) - give it much more room, and skip the retry
  // since a slow proxy is unlikely to suddenly be fast on a second try.
  const maxAttempts = proxyAgent ? 1 : 2;
  const timeoutMs = proxyAgent ? 20000 : 7000;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const startedAt = Date.now();
    try {
      const response = await fetchWithTimeout(
        `https://www.tiktok.com/@${encodeURIComponent(handle)}`,
        {
          headers: {
            "User-Agent": CRAWLER_USER_AGENT,
            "Accept-Language": "en-US,en;q=0.9",
          },
          cache: "no-store",
          ...(proxyAgent ? { dispatcher: proxyAgent } : {}),
        },
        timeoutMs
      );
      if (!response.ok) {
        console.warn(
          `[tiktok] crawler fetch for @${handle} returned HTTP ${response.status} (attempt ${attempt}/${maxAttempts})`
        );
        diagnostics?.push({
          label: "crawler",
          attempt,
          status: response.status,
          ok: false,
          durationMs: Date.now() - startedAt,
          viaProxy: Boolean(proxyAgent),
        });
        if (attempt < maxAttempts) {
          await sleep(500);
          continue;
        }
        return [];
      }

      const html = await response.text();
      const data = extractScriptJson(html, "ItemList");
      const items: any[] = Array.isArray(data?.itemListElement) ? data.itemListElement : [];

      if (items.length === 0) {
        console.warn(
          `[tiktok] crawler fetch for @${handle} succeeded but ItemList was empty/missing (attempt ${attempt}/${maxAttempts})`
        );
      }
      diagnostics?.push({
        label: "crawler",
        attempt,
        status: response.status,
        ok: true,
        durationMs: Date.now() - startedAt,
        note: `ItemList entries: ${items.length}, html length: ${html.length}`,
        viaProxy: Boolean(proxyAgent),
      });

      return items
        .map(mapJsonLdVideo)
        .filter((video): video is PublicVideoStats => video !== null)
        .sort((a, b) => (b.createTime ?? 0) - (a.createTime ?? 0));
    } catch (error) {
      console.error(`[tiktok] crawler fetch for @${handle} threw (attempt ${attempt}/${maxAttempts}):`, error);
      diagnostics?.push({
        label: "crawler",
        attempt,
        durationMs: Date.now() - startedAt,
        error: describeError(error),
        viaProxy: Boolean(proxyAgent),
      });
      if (attempt < maxAttempts) {
        await sleep(500);
        continue;
      }
      return [];
    }
  }
  return [];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  let parsed: number | null = null;
  if (typeof value === "number" && Number.isFinite(value)) {
    parsed = value;
  } else if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) {
    parsed = Number(value);
  }
  if (parsed === null) return null;

  // TikTok's own JSON-LD occasionally reports a large counter as a wrapped
  // signed 32-bit integer (observed: a video with ~2.4B views reported as
  // userInteractionCount: -1894967296). Every count/date/duration this
  // function parses is semantically non-negative, so recover the intended
  // value instead of surfacing a nonsensical negative number.
  return parsed < 0 ? parsed + 2 ** 32 : parsed;
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
