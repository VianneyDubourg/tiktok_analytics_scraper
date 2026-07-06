import { NextResponse } from "next/server";
import { getCounters } from "@/lib/redis";

export const dynamic = "force-dynamic";

export async function GET() {
  const counters = await getCounters();
  return NextResponse.json(counters);
}
