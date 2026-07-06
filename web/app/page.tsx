import { incrementViews } from "@/lib/redis";
import StatsExplorer from "@/components/StatsExplorer";

// Without this, Next prerenders the homepage once at build time and the
// view counter would freeze at whatever it read during that single build.
export const dynamic = "force-dynamic";

export default async function Home() {
  // Counter display is hidden in the UI for now (see StatsExplorer), but
  // views keep being tallied server-side so the count isn't lost in the
  // meantime - re-enabling the display later needs no backend change.
  await incrementViews();
  return <StatsExplorer />;
}
