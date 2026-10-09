export const REMOVE_AFTER = [
  { id: '1h', ms: 60 * 60 * 1000, label: '1 hour' },
  { id: '6h', ms: 6 * 60 * 60 * 1000, label: '6 hours' },
  { id: '1d', ms: 24 * 60 * 60 * 1000, label: '1 day' },
  { id: '7d', ms: 7 * 24 * 60 * 60 * 1000, label: '7 days' },
];

export const REMOVE_EVERY = [
  { id: '1h', ms: 60 * 60 * 1000, label: 'Every hour' },
  { id: '6h', ms: 6 * 60 * 60 * 1000, label: 'Every 6 hours' },
  { id: '1d', ms: 24 * 60 * 60 * 1000, label: 'Every day' },
  { id: '7d', ms: 7 * 24 * 60 * 60 * 1000, label: 'Every week' },
];

export const DEFAULT_SCHEDULE = {
  enabled: false,
  removeAfter: '7d',
  removeEvery: '1d',
  lastRunAt: null,
};

export function afterOption(id) {
  return REMOVE_AFTER.find((option) => option.id === id) || null;
}

export function everyOption(id) {
  return REMOVE_EVERY.find((option) => option.id === id) || null;
}
