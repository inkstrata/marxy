// Budget governor: decides whether agent work may start now, from the clock and the usage meters.
// Every time rule is in Los Angeles wall time, whatever zone the machine runs in.

export const POLICY = {
  tz: 'America/Los_Angeles',
  ownerWindow: { start: 14, end: 24 },
  lastBlockEnd: 14,
  fiveHour: { soft: 75, hard: 85 },
  weekly: { ownerShare: 60, floor: 15, sweepReserve: { thursday: 30, friday: 15 } },
  reset: { weekday: 5, hour: 20 },
  slots: [{ id: 'night', hour: 0, minute: 20 }, { id: 'day', hour: 8, minute: 45 }],
  blind: { maxBuilders: 2, maxHours: 3 },
  // Job profiles other than the default night/day/research-night rules. research-now serves requests the owner
  // marked "run now": any hour, but a stricter 5-hour line so that the owner coming back still has room.
  profiles: { 'research-now': { ignoreWindow: true, fiveHour: { soft: 60, hard: 70 }, maxHours: 3 } },
};

const HOUR = 3600e3;
const fmtCache = new Map();

function formatter(tz) {
  if (!fmtCache.has(tz)) {
    fmtCache.set(tz, new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', second: 'numeric',
    }));
  }
  return fmtCache.get(tz);
}

// Wall-clock parts of an instant in the zone; weekday 0 = Sunday.
export function localParts(date, tz = POLICY.tz) {
  const p = {};
  for (const { type, value } of formatter(tz).formatToParts(date)) p[type] = Number(value);
  const weekday = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
  return { year: p.year, month: p.month, day: p.day, hour: p.hour, minute: p.minute, second: p.second, weekday };
}

// The instant at which the zone's clock shows this wall time. Day overflow is allowed (day 32 is
// next month), which keeps calendar stepping simple. Two passes settle the offset across DST.
export function zonedTime(year, month, day, hour = 0, minute = 0, tz = POLICY.tz) {
  const want = Date.UTC(year, month - 1, day, hour, minute);
  let t = want;
  for (let i = 0; i < 2; i++) {
    const p = localParts(new Date(t), tz);
    const shown = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    t += want - shown;
  }
  return new Date(t);
}

// Friday 14:00 before the next weekly reset: the point the week's budget has to last until.
function weekEnd(now, policy) {
  const l = localParts(now, policy.tz);
  const ahead = (policy.reset.weekday - l.weekday + 7) % 7;
  let reset = zonedTime(l.year, l.month, l.day + ahead, policy.reset.hour, 0, policy.tz);
  if (reset <= now) reset = zonedTime(l.year, l.month, l.day + ahead + 7, policy.reset.hour, 0, policy.tz);
  const r = localParts(reset, policy.tz);
  return zonedTime(r.year, r.month, r.day, policy.lastBlockEnd, 0, policy.tz);
}

export function slotsUntilReset(now, policy = POLICY) {
  const end = weekEnd(now, policy);
  // A slot that began up to three hours ago is still being worked, so it still needs a share.
  const from = new Date(now.getTime() - 3 * HOUR);
  const l = localParts(from, policy.tz);
  let count = 0;
  for (let d = 0; d <= 8; d++) {
    for (const s of policy.slots) {
      const t = zonedTime(l.year, l.month, l.day + d, s.hour, s.minute, policy.tz);
      if (t >= from && t < end) count++;
    }
  }
  return Math.max(1, count);
}

export function fromGetUsage(plan) {
  const windows = Array.isArray(plan?.windows) ? plan.windows : [];
  const find = (needle) => windows.find((w) => String(w.label ?? '').toLowerCase().includes(needle));
  const meter = (w) => (w ? { pct: Number(w.percentUsed), resetsAt: w.resetsAt ?? null } : null);
  const fiveHour = meter(find('5-hour'));
  const weekly = meter(find('all models'));
  // Without both main meters the budget cannot be judged, so the caller falls back to blind mode.
  if (!fiveHour || !weekly || Number.isNaN(fiveHour.pct) || Number.isNaN(weekly.pct)) return null;
  const fable = find('fable');
  return { fiveHour, weekly, fable: fable ? { pct: Number(fable.percentUsed) } : null };
}

const round1 = (n) => Math.round(n * 10) / 10;

export function decide({ now, usage, ownerUsedPct = null, policy = POLICY, profile = 'night' }) {
  const prof = policy.profiles?.[profile];
  const line = prof?.fiveHour ?? policy.fiveHour;
  const out = {
    allowed: false, reason: '', noNewAgents: false, stopAt: null, allowancePct: null,
    sweep: false, blind: usage == null, reservePct: null, headroomPct: null,
  };
  const refuse = (reason) => ({ ...out, allowed: false, reason });
  const l = localParts(now, policy.tz);
  if (!prof?.ignoreWindow && l.hour >= policy.ownerWindow.start && l.hour < policy.ownerWindow.end) return refuse('owner window');

  // The owner's day starts at 14:00, and a 5-hour block running into it would eat their budget.
  const cutoff = zonedTime(l.year, l.month, l.day, policy.lastBlockEnd, 0, policy.tz);
  const fh = usage?.fiveHour;
  const resets = fh?.resetsAt ? new Date(fh.resetsAt) : null;
  const active = Boolean(resets && resets > now && fh.pct > 0);
  if (!prof?.ignoreWindow && active && resets > cutoff) return refuse('block reaches the owner window');
  if (!prof?.ignoreWindow && !active && now.getTime() + 5 * HOUR > cutoff.getTime()) return refuse('a new block would reach the owner window');
  // Once the current block expires, the next message would open a new one that crosses 14:00.
  let stopAt = cutoff;
  if (active && resets.getTime() + 5 * HOUR > cutoff.getTime() && resets < cutoff) stopAt = resets;
  if (prof?.ignoreWindow) stopAt = new Date(now.getTime() + prof.maxHours * HOUR);
  out.stopAt = stopAt.toISOString();

  // A run in the owner's own hours needs the meter to protect their allowance; blind is for the quiet night only.
  if (!usage && prof?.ignoreWindow) return refuse(`${profile} needs a usage reading`);
  if (!usage) {
    const capEnd = new Date(Math.min(stopAt.getTime(), now.getTime() + policy.blind.maxHours * HOUR));
    return {
      ...out, allowed: true, stopAt: capEnd.toISOString(),
      reason: `blind: usage unreadable, at most ${policy.blind.maxBuilders} builders for ${policy.blind.maxHours} hours`,
    };
  }

  if (fh.pct >= line.hard) return refuse('5-hour hard stop');
  out.noNewAgents = fh.pct >= line.soft;

  const w = policy.weekly;
  const weeklyPct = usage.weekly.pct;
  // Usage nobody can attribute is counted as the automation's, so the owner's whole share stays in reserve.
  const ownerUsed = ownerUsedPct ?? 0;
  out.sweep = l.weekday === 4 || (l.weekday === 5 && l.hour < policy.lastBlockEnd);
  let reserve = Math.max(w.floor, w.ownerShare - ownerUsed);
  if (out.sweep) {
    const cap = l.weekday === 4 ? w.sweepReserve.thursday : w.sweepReserve.friday;
    reserve = Math.max(w.floor, Math.min(w.ownerShare - ownerUsed, cap));
  }
  const headroom = 100 - reserve - weeklyPct;
  out.reservePct = round1(reserve);
  out.headroomPct = round1(headroom);
  if (headroom <= 0) return refuse('weekly reserve');
  out.allowancePct = round1(out.sweep ? headroom : headroom / slotsUntilReset(now, policy));
  return { ...out, allowed: true, reason: out.noNewAgents ? '5-hour soft limit: no new agents' : 'ok' };
}
