import { incrementViews } from "@/lib/redis";
import StatsExplorer from "@/components/StatsExplorer";

// Without this, Next prerenders the homepage once at build time and the
// view counter would freeze at whatever it read during that single build.
export const dynamic = "force-dynamic";

export default async function Home() {
  const counters = await incrementViews();
  return <StatsExplorer initialCounters={counters} />;
}
