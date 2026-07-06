"use client";

import { useState, type FormEvent } from "react";
import type { Counters, PublicProfileStats } from "@/types";
import { formatCount, formatDate, formatDuration, formatExact } from "@/lib/format";

interface Props {
  initialCounters: Counters;
}

type Status = "idle" | "loading" | "error" | "success";

export default function StatsExplorer({ initialCounters }: Props) {
  const [handle, setHandle] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [profile, setProfile] = useState<PublicProfileStats | null>(null);
  const [counters, setCounters] = useState<Counters>(initialCounters);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!handle.trim() || status === "loading") return;

    setStatus("loading");
    setErrorMessage("");

    try {
      const response = await fetch(`/api/stats?handle=${encodeURIComponent(handle.trim())}`);
      const data = await response.json();

      if (!response.ok) {
        setStatus("error");
        setErrorMessage(data.error ?? "Une erreur est survenue.");
        return;
      }

      setProfile(data.profile);
      setCounters((prev) => ({ ...prev, searches: data.searches ?? prev.searches }));
      setStatus("success");
    } catch {
      setStatus("error");
      setErrorMessage("Impossible de contacter le serveur.");
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-10 px-6 py-16">
      <header className="flex flex-col items-center gap-4 text-center">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
          TikTok Stats Checker
        </h1>
        <p className="max-w-xl text-balance text-zinc-600 dark:text-zinc-400">
          Entrez un identifiant TikTok public (@handle) pour voir ses statistiques
          publiques : abonnés, likes totaux, et vues / likes / commentaires /
          partages de ses dernières vidéos. Gratuit, instantané, sans
          connexion, sans compte.
        </p>
      </header>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3 sm:flex-row">
        <div className="flex flex-1 items-center rounded-full border border-zinc-300 bg-white px-5 py-3 dark:border-zinc-700 dark:bg-zinc-900">
          <span className="text-zinc-400">@</span>
          <input
            value={handle}
            onChange={(event) => setHandle(event.target.value)}
            placeholder="nom.dutilisateur"
            className="w-full bg-transparent px-1 outline-none placeholder:text-zinc-400"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
        </div>
        <button
          type="submit"
          disabled={status === "loading" || !handle.trim()}
          className="rounded-full bg-zinc-950 px-8 py-3 font-medium text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200"
        >
          {status === "loading" ? "Analyse..." : "Analyser"}
        </button>
      </form>

      {status === "error" && (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {errorMessage}
        </p>
      )}

      {profile && status === "success" && <ProfileResults profile={profile} />}

      <footer className="mt-auto flex justify-center gap-6 pt-10 text-sm text-zinc-500 dark:text-zinc-500">
        <span>👀 {formatExact(counters.views)} visites</span>
        <span>🔎 {formatExact(counters.searches)} comptes analysés</span>
      </footer>
    </div>
  );
}

function ProfileResults({ profile }: { profile: PublicProfileStats }) {
  return (
    <section className="flex flex-col gap-8">
      <div className="flex flex-col items-center gap-4 rounded-2xl border border-zinc-200 p-6 text-center sm:flex-row sm:text-left dark:border-zinc-800">
        {profile.avatar && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={profile.avatar} alt={profile.nickname} className="h-20 w-20 rounded-full object-cover" />
        )}
        <div>
          <h2 className="text-xl font-semibold">
            {profile.nickname} {profile.verified && <span title="Vérifié">✅</span>}
          </h2>
          <p className="text-zinc-500">@{profile.handle}</p>
          {profile.bio && <p className="mt-1 max-w-md text-sm text-zinc-600 dark:text-zinc-400">{profile.bio}</p>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatTile label="Abonnés" value={formatCount(profile.followers)} />
        <StatTile label="Abonnements" value={formatCount(profile.following)} />
        <StatTile label="Likes totaux" value={formatCount(profile.totalLikes)} />
        <StatTile label="Vidéos" value={formatCount(profile.videoCount)} />
      </div>

      {profile.videos.length > 0 ? (
        <div className="flex flex-col gap-4">
          <div>
            <h3 className="text-lg font-semibold">
              Vidéos récentes ({profile.videos.length})
            </h3>
            <p className="text-xs text-zinc-400">
              TikTok ne fournit publiquement qu&apos;un échantillon des vidéos
              les plus récentes, pas le catalogue complet.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {profile.videos.map((video) => (
              <a
                key={video.id}
                href={video.url || undefined}
                target="_blank"
                rel="noopener noreferrer"
                className="flex flex-col gap-2 rounded-xl border border-zinc-200 p-3 transition-colors hover:border-zinc-400 dark:border-zinc-800 dark:hover:border-zinc-600"
              >
                <div className="flex gap-3">
                  {video.cover && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={video.cover} alt="" className="h-24 w-16 shrink-0 rounded-lg object-cover" />
                  )}
                  <div className="flex flex-col gap-1 text-sm">
                    <p className="line-clamp-3 text-zinc-700 dark:text-zinc-300">
                      {video.description || "(sans description)"}
                    </p>
                    <p className="text-xs text-zinc-400">
                      {formatDate(video.createTime)} · {formatDuration(video.durationSeconds)}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-zinc-500">
                  <span>👁 {formatCount(video.views)}</span>
                  <span>❤️ {formatCount(video.likes)}</span>
                  <span>💬 {formatCount(video.comments)}</span>
                  <span>↗️ {formatCount(video.shares)}</span>
                  {video.saves !== null && <span>⭐ {formatCount(video.saves)}</span>}
                </div>
              </a>
            ))}
          </div>
        </div>
      ) : (
        <p className="rounded-lg bg-zinc-50 px-4 py-3 text-center text-sm text-zinc-500 dark:bg-zinc-900">
          Le détail par vidéo est temporairement indisponible pour ce compte
          (limite de trafic TikTok probable). Les statistiques globales du
          profil ci-dessus restent fiables : réessayez dans quelques minutes
          pour le détail par vidéo.
        </p>
      )}
    </section>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-xl border border-zinc-200 py-4 dark:border-zinc-800">
      <span className="text-2xl font-semibold">{value}</span>
      <span className="text-xs uppercase tracking-wide text-zinc-500">{label}</span>
    </div>
  );
}
