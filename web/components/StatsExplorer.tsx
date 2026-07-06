"use client";

import { useState, type FormEvent } from "react";
import type { PublicProfileStats } from "@/types";
import { formatCount, formatDate, formatDuration } from "@/lib/format";
import {
  AlertIcon,
  AtIcon,
  BadgeCheckIcon,
  BookmarkIcon,
  ClipIcon,
  CommentIcon,
  EyeIcon,
  HeartIcon,
  RefreshIcon,
  SearchIcon,
  ShareIcon,
  UserPlusIcon,
  UsersIcon,
} from "@/components/icons";

type Status = "idle" | "loading" | "error" | "success";

export default function StatsExplorer() {
  const [handle, setHandle] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [profile, setProfile] = useState<PublicProfileStats | null>(null);
  const [videosRetrying, setVideosRetrying] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!handle.trim() || status === "loading") return;

    setStatus("loading");
    setErrorMessage("");
    setProfile(null);

    try {
      const response = await fetch(`/api/stats?handle=${encodeURIComponent(handle.trim())}`);
      const data = await response.json();

      if (!response.ok) {
        setStatus("error");
        setErrorMessage(data.error ?? "Une erreur est survenue.");
        return;
      }

      setProfile(data.profile);
      setStatus("success");
    } catch {
      setStatus("error");
      setErrorMessage("Impossible de contacter le serveur.");
    }
  }

  async function retryVideos() {
    if (!profile || videosRetrying) return;
    setVideosRetrying(true);
    try {
      const response = await fetch(`/api/stats?handle=${encodeURIComponent(profile.handle)}`);
      const data = await response.json();
      if (response.ok) {
        setProfile(data.profile);
      }
    } catch {
      // Best effort: keep whatever we already had if the retry itself fails.
    } finally {
      setVideosRetrying(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-12 px-6 py-16 sm:py-24">
      <header className="flex flex-col items-center gap-5 text-center animate-rise-in">
        <span className="surface-card rounded-full px-4 py-1.5 text-xs font-medium tracking-wide text-[var(--muted)]">
          Gratuit · Sans connexion · Instantané
        </span>
        <h1 className="text-4xl font-bold tracking-tight sm:text-6xl">
          <span className="gradient-text">TikTok Stats</span> Checker
        </h1>
        <p className="max-w-xl text-balance text-base text-[var(--muted)] sm:text-lg">
          Entrez un identifiant TikTok public pour voir ses statistiques :
          abonnés, likes totaux, et vues / likes / commentaires / partages de
          ses dernières vidéos.
        </p>
      </header>

      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-3 animate-rise-in sm:flex-row"
        style={{ animationDelay: "80ms" }}
      >
        <div className="glow-ring surface-card flex flex-1 items-center gap-2 rounded-full px-5 py-3.5 transition-shadow">
          <AtIcon className="h-4 w-4 shrink-0 text-[var(--muted)]" />
          <input
            value={handle}
            onChange={(event) => setHandle(event.target.value)}
            placeholder="nom.dutilisateur"
            className="w-full bg-transparent outline-none placeholder:text-[var(--muted)]"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
        </div>
        <button
          type="submit"
          disabled={status === "loading" || !handle.trim()}
          className="flex items-center justify-center gap-2 rounded-full px-7 py-3.5 font-medium text-white shadow-lg shadow-pink-500/10 transition-transform hover:scale-[1.02] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100"
          style={{ background: "var(--accent-gradient)" }}
        >
          {status === "loading" ? (
            <>
              <RefreshIcon className="h-4 w-4 animate-spin" />
              Analyse...
            </>
          ) : (
            <>
              <SearchIcon className="h-4 w-4" />
              Analyser
            </>
          )}
        </button>
      </form>

      {status === "error" && (
        <div className="surface-card animate-rise-in flex items-start gap-3 rounded-2xl px-5 py-4 text-sm text-[var(--foreground)]">
          <AlertIcon className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent-pink)]" />
          <p>{errorMessage}</p>
        </div>
      )}

      {status === "loading" && <ResultsSkeleton />}

      {profile && status === "success" && (
        <ProfileResults profile={profile} onRetryVideos={retryVideos} videosRetrying={videosRetrying} />
      )}

      <footer className="mt-auto flex flex-col items-center gap-4 pt-10 text-xs text-[var(--muted)] sm:text-sm">
        {/* Visit/search counters hidden for now (Upstash not yet connected) -
            see app/page.tsx and lib/redis.ts, both still counting silently. */}
        <p className="flex flex-wrap items-center justify-center gap-1 text-center">
          100% gratuit &amp; open source · Codé avec
          <HeartIcon fill="currentColor" className="h-3.5 w-3.5 text-[var(--accent-pink)]" />
          par{" "}
          <a
            href="https://www.instagram.com/vianney_fpv"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-[var(--foreground)] underline decoration-[var(--surface-border)] underline-offset-2 hover:decoration-[var(--accent-pink)]"
          >
            @vianney_fpv
          </a>
        </p>
      </footer>
    </div>
  );
}

function ResultsSkeleton() {
  return (
    <div className="flex flex-col gap-8 animate-rise-in">
      <div className="surface-card flex items-center gap-4 rounded-2xl p-6">
        <div className="skeleton h-20 w-20 shrink-0 rounded-full" />
        <div className="flex flex-1 flex-col gap-2">
          <div className="skeleton h-5 w-40 rounded-md" />
          <div className="skeleton h-4 w-24 rounded-md" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="skeleton h-20 rounded-xl" />
        ))}
      </div>
    </div>
  );
}

interface ProfileResultsProps {
  profile: PublicProfileStats;
  onRetryVideos: () => void;
  videosRetrying: boolean;
}

function ProfileResults({ profile, onRetryVideos, videosRetrying }: ProfileResultsProps) {
  return (
    <section className="flex flex-col gap-8 animate-rise-in">
      <div className="surface-card flex flex-col items-center gap-4 rounded-2xl p-6 text-center sm:flex-row sm:text-left">
        {profile.avatar && (
          <div className="shrink-0 rounded-full p-[2px]" style={{ background: "var(--accent-gradient)" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={profile.avatar}
              alt={profile.nickname}
              className="h-20 w-20 rounded-full border-2 object-cover"
              style={{ borderColor: "var(--background)" }}
            />
          </div>
        )}
        <div>
          <h2 className="flex items-center justify-center gap-1.5 text-xl font-semibold sm:justify-start">
            {profile.nickname}
            {profile.verified && <BadgeCheckIcon className="h-4 w-4 text-[var(--accent-pink)]" />}
          </h2>
          <p className="text-[var(--muted)]">@{profile.handle}</p>
          {profile.bio && <p className="mt-1 max-w-md text-sm text-[var(--muted)]">{profile.bio}</p>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatTile icon={<UsersIcon className="h-4 w-4" />} label="Abonnés" value={formatCount(profile.followers)} />
        <StatTile
          icon={<UserPlusIcon className="h-4 w-4" />}
          label="Abonnements"
          value={formatCount(profile.following)}
        />
        <StatTile icon={<HeartIcon className="h-4 w-4" />} label="Likes totaux" value={formatCount(profile.totalLikes)} />
        <StatTile icon={<ClipIcon className="h-4 w-4" />} label="Vidéos" value={formatCount(profile.videoCount)} />
      </div>

      {profile.videos.length > 0 ? (
        <div className="flex flex-col gap-4">
          <div>
            <h3 className="text-lg font-semibold">Vidéos récentes ({profile.videos.length})</h3>
            <p className="text-xs text-[var(--muted)]">
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
                className="surface-card flex flex-col gap-3 rounded-xl p-3 transition-all hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/5"
              >
                <div className="flex gap-3">
                  {video.cover && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={video.cover} alt="" className="h-24 w-16 shrink-0 rounded-lg object-cover" />
                  )}
                  <div className="flex flex-col gap-1 text-sm">
                    <p className="line-clamp-3 text-[var(--foreground)]">
                      {video.description || "(sans description)"}
                    </p>
                    <p className="flex items-center gap-1 text-xs text-[var(--muted)]">
                      {formatDate(video.createTime)} · {formatDuration(video.durationSeconds)}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--muted)]">
                  <span className="flex items-center gap-1">
                    <EyeIcon className="h-3.5 w-3.5" /> {formatCount(video.views)}
                  </span>
                  <span className="flex items-center gap-1">
                    <HeartIcon className="h-3.5 w-3.5" /> {formatCount(video.likes)}
                  </span>
                  <span className="flex items-center gap-1">
                    <CommentIcon className="h-3.5 w-3.5" /> {formatCount(video.comments)}
                  </span>
                  <span className="flex items-center gap-1">
                    <ShareIcon className="h-3.5 w-3.5" /> {formatCount(video.shares)}
                  </span>
                  {video.saves !== null && (
                    <span className="flex items-center gap-1">
                      <BookmarkIcon className="h-3.5 w-3.5" /> {formatCount(video.saves)}
                    </span>
                  )}
                </div>
              </a>
            ))}
          </div>
        </div>
      ) : profile.videoCount === 0 ? (
        <div className="surface-card flex flex-col items-center gap-2 rounded-2xl px-5 py-6 text-center text-sm text-[var(--muted)]">
          <ClipIcon className="h-5 w-5 text-[var(--muted)]" />
          <p>Ce compte n&apos;a pas encore publié de vidéo publique.</p>
        </div>
      ) : (
        <div className="surface-card flex flex-col items-center gap-3 rounded-2xl px-5 py-6 text-center text-sm text-[var(--muted)]">
          <AlertIcon className="h-5 w-5 text-[var(--accent-pink)]" />
          <p>
            Le détail par vidéo est temporairement indisponible pour ce compte
            (limite de trafic TikTok probable). Les statistiques globales du
            profil ci-dessus restent fiables.
          </p>
          <button
            type="button"
            onClick={onRetryVideos}
            disabled={videosRetrying}
            className="flex items-center gap-2 rounded-full border border-[var(--surface-border)] px-4 py-2 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--surface)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshIcon className={`h-3.5 w-3.5 ${videosRetrying ? "animate-spin" : ""}`} />
            {videosRetrying ? "Nouvelle tentative..." : "Réessayer"}
          </button>
        </div>
      )}
    </section>
  );
}

function StatTile({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="surface-card flex flex-col items-center gap-1.5 rounded-xl py-5 transition-transform hover:-translate-y-0.5">
      <span className="text-[var(--accent-pink)]">{icon}</span>
      <span className="text-2xl font-semibold">{value}</span>
      <span className="text-xs uppercase tracking-wide text-[var(--muted)]">{label}</span>
    </div>
  );
}
