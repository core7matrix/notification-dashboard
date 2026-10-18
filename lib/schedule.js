const DAY_MS = 24 * 60 * 60 * 1000;

export const REMOVE_AFTER = [1, 2, 3, 4, 5, 6].map((days) => ({
  id: `${days}d`,
  ms: days * DAY_MS,
  label: days === 1 ? '1 day' : `${days} days`,
}));

export const REMOVE_EVERY = [
  { id: '1h', ms: 60 * 60 * 1000, label: 'Every hour' },
  { id: '6h', ms: 6 * 60 * 60 * 1000, label: 'Every 6 hours' },
  { id: '1d', ms: 24 * 60 * 60 * 1000, label: 'Every day' },
  { id: '7d', ms: 7 * 24 * 60 * 60 * 1000, label: 'Every week' },
];

export const DEFAULT_SCHEDULE = {
  enabled: false,
  removeAfter: '6d',
  removeEvery: '1d',
  lastRunAt: null,
};

export function afterOption(id) {
  return REMOVE_AFTER.find((option) => option.id === id) || null;
}

export function everyOption(id) {
  return REMOVE_EVERY.find((option) => option.id === id) || null;
}
