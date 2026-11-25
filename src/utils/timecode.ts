/**
 * Format seconds into HH:MM:SS or HH:MM:SS.mmm
 */
export function formatTimecode(seconds: number, withMillis = false): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return withMillis ? '00:00:00.000' : '00:00:00';
  }
  const totalMs = Math.round(seconds * 1000);
  const ms = totalMs % 1000;
  const totalSec = Math.floor(totalMs / 1000);
  const s = totalSec % 60;
  const totalMin = Math.floor(totalSec / 60);
  const m = totalMin % 60;
  const h = Math.floor(totalMin / 60);

  const hh = String(h).padStart(2, '0');
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  if (withMillis) {
    return `${hh}:${mm}:${ss}.${String(ms).padStart(3, '0')}`;
  }
  return `${hh}:${mm}:${ss}`;
}

/**
 * Parse a single timestamp token:
 * Supports HH:MM:SS.mmm, HH:MM:SS, MM:SS, MM:SS.ms, raw seconds ("85" / "85s"),
 * plus keywords: 开头 / 开始 / start / 末尾 / 结尾 / 结束 / end / eof
 */
export function parseTimeToken(raw: string, duration: number): number | null {
  const token = raw.trim().replace(/[：]/g, ':').toLowerCase();
  if (!token) return null;

  if (['开头', '开始', '起', 'start', 'begin', 'beginning'].includes(token)) {
    return 0;
  }
  if (['末尾', '结尾', '结束', '最后', '尾', 'end', 'eof', 'finish'].includes(token)) {
    return Math.max(0, duration);
  }

  // Raw seconds like "125" or "125.5s"
  if (/^\d+(\.\d+)?s?$/.test(token)) {
    const val = parseFloat(token.replace(/s$/, ''));
    return Number.isFinite(val) ? Math.min(val, Math.max(duration, val)) : null;
  }

  // Colon-separated HH:MM:SS(.ms) or MM:SS(.ms)
  const parts = token.split(':');
  if (parts.length === 2 || parts.length === 3) {
    const nums = parts.map((p) => Number(p));
    if (nums.some((n) => !Number.isFinite(n) || n < 0)) return null;
    let sec = 0;
    if (parts.length === 2) {
      sec = nums[0] * 60 + nums[1];
    } else {
      sec = nums[0] * 3600 + nums[1] * 60 + nums[2];
    }
    return duration > 0 ? Math.min(sec, duration) : sec;
  }

  return null;
}

export interface ParsedBatchResult {
  ranges: Array<{ start: number; end: number; raw: string }>;
  errors: string[];
}

/**
 * Smart batch time-range parser!
 * Handles inputs such as:
 *   "00:01:25-00:02:10 和 00:28:12-00:50:00 和 00:59:32-末尾"
 *   "00:01:25 ~ 00:02:10, 00:28:12 至 00:50:00\n00:59:32 到 结尾"
 */
export function parseBatchTimeRanges(input: string, duration: number): ParsedBatchResult {
  const ranges: Array<{ start: number; end: number; raw: string }> = [];
  const errors: string[] = [];

  if (!input.trim()) {
    return { ranges, errors };
  }

  // Normalize range separators and split into chunks by delimiters (newlines, commas, 和, 、, 以及, ;)
  const normalized = input
    .replace(/[：]/g, ':')
    .replace(/\s*(?:以及|和|与|、|，|,|；|;|\n|\r)+\s*/g, '\n');

  // Further split chunks that contain multiple ranges separated by spaces
  // e.g. "00:01:00-00:02:00 00:05:00-00:06:00"
  const pairRegex =
    /((?:\d{1,2}:)?\d{1,2}:\d{1,2}(?:\.\d+)?|\d+(?:\.\d+)?s?|开头|开始|start|begin)\s*(?:-|~|～|—|–|到|至|to)\s*((?:\d{1,2}:)?\d{1,2}:\d{1,2}(?:\.\d+)?|\d+(?:\.\d+)?s?|末尾|结尾|结束|最后|end|eof)/gi;

  const lines = normalized
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  for (const line of lines) {
    let matchedAny = false;
    pairRegex.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pairRegex.exec(line)) !== null) {
      matchedAny = true;
      const start = parseTimeToken(m[1], duration);
      const end = parseTimeToken(m[2], duration);
      if (start === null || end === null) {
        errors.push(`无法解析时间段: "${m[0]}"`);
        continue;
      }
      if (end <= start) {
        errors.push(`结束时间必须大于开始时间: "${m[0]}"`);
        continue;
      }
      ranges.push({
        start: Math.max(0, start),
        end: duration > 0 ? Math.min(end, duration) : end,
        raw: m[0],
      });
    }
    if (!matchedAny) {
      errors.push(`未识别的格式: "${line}"`);
    }
  }

  ranges.sort((a, b) => a.start - b.start);
  return { ranges, errors };
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let idx = 0;
  let val = bytes;
  while (val >= 1024 && idx < units.length - 1) {
    val /= 1024;
    idx++;
  }
  return `${val >= 100 ? val.toFixed(1) : val.toFixed(2)} ${units[idx]}`;
}

export function formatBitrate(bps: number | null): string {
  if (!bps || bps <= 0) return '';
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(1)} Mbps`;
  return `${Math.round(bps / 1000)} kbps`;
}
