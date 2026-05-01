const PERIODS = new Set(['today', '7d', '30d', 'month']);

function pad2(value) {
  return String(value).padStart(2, '0');
}

function pad3(value) {
  return String(value).padStart(3, '0');
}

function cloneDate(value) {
  return new Date(value.getTime());
}

export function normalizePeriod(value) {
  return PERIODS.has(value) ? value : '7d';
}

export function startOfLocalDay(value) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

export function endOfLocalDay(value) {
  const date = new Date(value);
  date.setHours(23, 59, 59, 999);
  return date;
}

export function toLocalDateKey(value) {
  const date = new Date(value);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function fromDateKey(key) {
  const [year, month, day] = String(key).split('-').map(part => Number.parseInt(part, 10));
  return new Date(year, (month || 1) - 1, day || 1, 0, 0, 0, 0);
}

export function dayLabel(value) {
  const date = new Date(value);
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getDay()];
}

export function toLocalIsoString(value) {
  const date = new Date(value);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}.${pad3(date.getMilliseconds())}`;
}

export function buildWindow(period = '7d', nowValue = new Date()) {
  const normalized = normalizePeriod(period);
  const now = new Date(nowValue);
  const todayStart = startOfLocalDay(now);
  const todayEnd = endOfLocalDay(now);
  const start = cloneDate(todayStart);
  const end = cloneDate(todayEnd);

  let label = 'Last 7 days';

  if (normalized === 'today') {
    label = 'Today';
  } else if (normalized === '7d') {
    start.setDate(start.getDate() - 6);
    label = 'Last 7 days';
  } else if (normalized === '30d') {
    start.setDate(start.getDate() - 29);
    label = 'Last 30 days';
  } else if (normalized === 'month') {
    start.setDate(1);
    label = now.toLocaleString('en-US', { month: 'long', year: 'numeric' });
  }

  return {
    period: normalized,
    label,
    start,
    end,
    startMs: start.getTime(),
    endMs: end.getTime(),
    dayCount: Math.max(1, Math.floor((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1),
    window: {
      timezone: 'local',
      start: toLocalIsoString(start),
      end: toLocalIsoString(end),
      label,
    },
  };
}

export function listWindowDates(period = '7d', nowValue = new Date()) {
  const window = buildWindow(period, nowValue);
  const dates = [];

  for (let index = 0; index < window.dayCount; index++) {
    const current = cloneDate(window.start);
    current.setDate(window.start.getDate() + index);
    dates.push(current);
  }

  return { window, dates };
}
