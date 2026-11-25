import type { CutMode, CutRange, ExportSegment } from '../types/media';

/**
 * Binary search for the nearest keyframe timestamp in a sorted keyframes array.
 */
export function snapToNearestKeyframe(
  time: number,
  keyframes: number[],
  duration: number,
  mode: 'nearest' | 'prev' | 'next' = 'nearest'
): number {
  if (time <= 0.05) return 0;
  if (duration > 0 && time >= duration - 0.05) return duration;
  if (!keyframes || keyframes.length === 0) return time;

  let lo = 0;
  let hi = keyframes.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (keyframes[mid] < time) lo = mid + 1;
    else hi = mid;
  }

  const after = keyframes[lo];
  const before = lo > 0 ? keyframes[lo - 1] : keyframes[0];

  if (mode === 'prev') return before;
  if (mode === 'next') return after;

  // Also compare with exact end of file
  const bestKf = Math.abs(time - before) <= Math.abs(after - time) ? before : after;
  if (duration > 0 && Math.abs(duration - time) < Math.abs(bestKf - time)) {
    return duration;
  }
  return bestKf;
}

/**
 * Find previous or next keyframe strictly relative to current time.
 */
export function stepKeyframe(
  currentTime: number,
  keyframes: number[],
  direction: 'prev' | 'next',
  duration: number
): number {
  if (!keyframes || keyframes.length === 0) {
    return Math.max(0, Math.min(duration, currentTime + (direction === 'next' ? 2 : -2)));
  }

  const eps = 0.04;
  if (direction === 'next') {
    for (let i = 0; i < keyframes.length; i++) {
      if (keyframes[i] > currentTime + eps) {
        return keyframes[i];
      }
    }
    return duration;
  } else {
    for (let i = keyframes.length - 1; i >= 0; i--) {
      if (keyframes[i] < currentTime - eps) {
        return keyframes[i];
      }
    }
    return 0;
  }
}

/**
 * Merge overlapping or adjacent ranges.
 */
export function mergeRanges(ranges: Array<{ start: number; end: number }>): ExportSegment[] {
  const clean = ranges
    .filter((r) => r.end > r.start + 0.01)
    .map((r) => ({ start: r.start, end: r.end }))
    .sort((a, b) => a.start - b.start);

  if (clean.length === 0) return [];

  const merged: ExportSegment[] = [clean[0]];
  for (let i = 1; i < clean.length; i++) {
    const last = merged[merged.length - 1];
    if (clean[i].start <= last.end + 0.02) {
      last.end = Math.max(last.end, clean[i].end);
    } else {
      merged.push(clean[i]);
    }
  }
  return merged;
}

/**
 * Compute final kept video segments from user CutRanges + CutMode ('remove' | 'keep')
 * with optional keyframe snapping for strict 0-reencode lossless cuts.
 */
export function computeKeptSegments(
  ranges: CutRange[],
  mode: CutMode,
  duration: number,
  keyframes: number[],
  snapKeyframes: boolean
): { segments: ExportSegment[]; isFullFile: boolean } {
  if (duration <= 0) {
    return { segments: [], isFullFile: true };
  }

  if (ranges.length === 0) {
    return {
      segments: [{ start: 0, end: duration }],
      isFullFile: true,
    };
  }

  // First merge user ranges
  const merged = mergeRanges(ranges);

  let rawKept: ExportSegment[];
  if (mode === 'keep') {
    rawKept = merged;
  } else {
    // Invert merged removed intervals to get kept intervals
    rawKept = [];
    let cursor = 0;
    for (const cut of merged) {
      if (cut.start > cursor + 0.05) {
        rawKept.push({ start: cursor, end: cut.start });
      }
      cursor = Math.max(cursor, cut.end);
    }
    if (duration - cursor > 0.05) {
      rawKept.push({ start: cursor, end: duration });
    }
  }

  if (!snapKeyframes || keyframes.length === 0) {
    const finalSegs = mergeRanges(rawKept);
    const isFull =
      finalSegs.length === 1 &&
      finalSegs[0].start <= 0.05 &&
      finalSegs[0].end >= duration - 0.05;
    return { segments: finalSegs, isFullFile: isFull };
  }

  // Snap each kept segment boundary to exact video keyframes
  const snapped = rawKept
    .map((seg) => {
      const s = seg.start <= 0.05 ? 0 : snapToNearestKeyframe(seg.start, keyframes, duration, 'nearest');
      const e =
        seg.end >= duration - 0.05
          ? duration
          : snapToNearestKeyframe(seg.end, keyframes, duration, 'nearest');
      return { start: s, end: e };
    })
    .filter((seg) => seg.end > seg.start + 0.05);

  const finalSegs = mergeRanges(snapped);
  const isFull =
    finalSegs.length === 1 &&
    finalSegs[0].start <= 0.05 &&
    finalSegs[0].end >= duration - 0.05;

  return { segments: finalSegs, isFullFile: isFull };
}
