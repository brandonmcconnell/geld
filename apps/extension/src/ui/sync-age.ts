export interface SyncAge {
  readonly accessible: string;
  readonly compact: string;
}

export function formatSyncAge(timestamp: number, now = Date.now()): SyncAge {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 60) return { compact: 'now', accessible: 'Synced just now' };
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    const unit = minutes === 1 ? 'minute' : 'minutes';
    return { compact: `${minutes} ${minutes === 1 ? 'min' : 'mins'}`, accessible: `Synced ${minutes} ${unit} ago` };
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    const unit = hours === 1 ? 'hour' : 'hours';
    return { compact: `${hours} ${hours === 1 ? 'hr' : 'hrs'}`, accessible: `Synced ${hours} ${unit} ago` };
  }
  const days = Math.round(hours / 24);
  if (days < 30) {
    const unit = days === 1 ? 'day' : 'days';
    return { compact: `${days} ${unit}`, accessible: `Synced ${days} ${unit} ago` };
  }
  const date = new Date(timestamp);
  return { compact: date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }), accessible: `Synced ${date.toLocaleString()}` };
}
