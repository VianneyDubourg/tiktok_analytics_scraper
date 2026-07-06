const ABBREVIATIONS: [number, string][] = [
  [1_000_000_000, "B"],
  [1_000_000, "M"],
  [1_000, "K"],
];

export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  for (const [threshold, suffix] of ABBREVIATIONS) {
    if (Math.abs(value) >= threshold) {
      return `${(value / threshold).toFixed(1).replace(/\.0$/, "")}${suffix}`;
    }
  }
  return value.toLocaleString("en-US");
}

export function formatExact(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return value.toLocaleString("en-US");
}

export function formatDate(epochSeconds: number | null | undefined): string {
  if (!epochSeconds) return "—";
  return new Date(epochSeconds * 1000).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "—";
  const minutes = Math.floor(seconds / 60);
  const remaining = Math.floor(seconds % 60);
  return `${minutes}:${remaining.toString().padStart(2, "0")}`;
}
