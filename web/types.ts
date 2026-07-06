export interface PublicVideoStats {
  id: string;
  description: string;
  url: string;
  createTime: number | null;
  durationSeconds: number | null;
  cover: string;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
}

export interface PublicProfileStats {
  handle: string;
  nickname: string;
  avatar: string;
  bio: string;
  verified: boolean;
  followers: number | null;
  following: number | null;
  totalLikes: number | null;
  videoCount: number | null;
  videos: PublicVideoStats[];
}

export interface Counters {
  views: number;
  searches: number;
}
