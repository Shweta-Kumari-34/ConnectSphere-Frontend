export type StoryTimingLike = {
  createdAt?: string | null;
  expiresAt?: string | null;
};

const STORY_LIFETIME_MS = 24 * 60 * 60 * 1000;

function toTimestamp(value?: string | null): number | null {
  if (!value) {
    return null;
  }
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

export function getStoryCreatedAtMs(story: StoryTimingLike): number | null {
  return toTimestamp(story.createdAt);
}

export function getStoryExpiresAtMs(story: StoryTimingLike): number | null {
  const explicitExpiry = toTimestamp(story.expiresAt);
  if (explicitExpiry !== null) {
    return explicitExpiry;
  }

  const createdAt = getStoryCreatedAtMs(story);
  if (createdAt === null) {
    return null;
  }

  return createdAt + STORY_LIFETIME_MS;
}

export function isStoryActiveNow(story: StoryTimingLike, nowMs = Date.now()): boolean {
  const expiresAt = getStoryExpiresAtMs(story);
  if (expiresAt === null) {
    return false;
  }
  return expiresAt > nowMs;
}

export function formatStoryAgeShort(story: StoryTimingLike, nowMs = Date.now()): string {
  const createdAt = getStoryCreatedAtMs(story);
  if (createdAt === null) {
    return '';
  }

  const diffSeconds = Math.max(0, Math.floor((nowMs - createdAt) / 1000));
  if (diffSeconds < 60) {
    return 'now';
  }
  if (diffSeconds < 3600) {
    return `${Math.floor(diffSeconds / 60)}m`;
  }
  if (diffSeconds < 86400) {
    return `${Math.floor(diffSeconds / 3600)}h`;
  }
  return `${Math.floor(diffSeconds / 86400)}d`;
}

