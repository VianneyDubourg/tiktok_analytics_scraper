import { Redis } from "@upstash/redis";
import type { Counters } from "@/types";

const VIEWS_KEY = "tiktok-stats:views";
const SEARCHES_KEY = "tiktok-stats:searches";

let client: Redis | null | undefined;

/**
 * Counters are optional infrastructure: without Upstash env vars configured
 * (e.g. running locally without setup) every call below degrades to
 * returning zeros instead of throwing, so the rest of the app keeps working.
 */
function getClient(): Redis | null {
  if (client !== undefined) return client;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  client = url && token ? new Redis({ url, token }) : null;
  return client;
}

export async function incrementViews(): Promise<Counters> {
  const redis = getClient();
  if (!redis) return { views: 0, searches: 0 };
  const [views, searches] = await Promise.all([
    redis.incr(VIEWS_KEY),
    redis.get<number>(SEARCHES_KEY),
  ]);
  return { views, searches: searches ?? 0 };
}

export async function incrementSearches(): Promise<number> {
  const redis = getClient();
  if (!redis) return 0;
  return redis.incr(SEARCHES_KEY);
}

export async function getCounters(): Promise<Counters> {
  const redis = getClient();
  if (!redis) return { views: 0, searches: 0 };
  const [views, searches] = await Promise.all([
    redis.get<number>(VIEWS_KEY),
    redis.get<number>(SEARCHES_KEY),
  ]);
  return { views: views ?? 0, searches: searches ?? 0 };
}
