import type { MediaInfo } from '../types/media';

/**
 * All supported import video container extensions — aligned 1:1 with the 8 export formats
 * (MP4, MKV, MOV, WebM, AVI, TS, FLV, M4V) plus common MPEG-TS aliases (M2TS, MTS).
 */
export const SUPPORTED_VIDEO_EXTENSIONS = [
  'mp4',
  'mkv',
  'mov',
  'webm',
  'avi',
  'ts',
  'flv',
  'm4v',
  'm2ts',
  'mts',
] as const;

export interface MediaFormatCapabilities {
  /** Normalized display label for the detected container (e.g. "MKV", "MP4", "AVI", "FLV", "TS"). */
  container: string;
  /** Whether the container format supports multi-track audio editing (naming, import, reorder, mixing). */
  supportsAudioEdit: boolean;
  /** Whether the container format supports embedded soft-subtitle track editing & muxing. */
  supportsSubtitleEdit: boolean;
}

function getFileExtension(pathOrName: string): string {
  const clean = pathOrName.trim();
  const dot = clean.lastIndexOf('.');
  if (dot <= 0 || dot === clean.length - 1) return '';
  return clean.slice(dot + 1).toLowerCase();
}

function detectContainerKey(media: MediaInfo): string {
  const ext = getFileExtension(media.file_name || media.file_path || '');
  if (ext) return ext;

  const fmt = (media.format_name || '').toLowerCase();
  if (fmt.includes('flv')) return 'flv';
  if (fmt.includes('avi')) return 'avi';
  if (fmt.includes('mpegts')) return 'ts';
  if (fmt.includes('webm')) return 'webm';
  if (fmt.includes('matroska')) return 'mkv';
  if (fmt.includes('mov')) return 'mov';
  if (fmt.includes('mp4')) return 'mp4';
  return 'unknown';
}

function formatContainerLabel(key: string): string {
  if (key === 'webm') return 'WebM';
  if (key === 'm2ts' || key === 'mts') return 'TS';
  if (key === 'unknown') return 'VIDEO';
  return key.toUpperCase();
}

/**
 * Determines which editing features (audio track management, subtitle editing)
 * are natively supported for a loaded video's container format.
 *
 * - MKV / MP4 / MOV / M4V / WebM: Full audio track & subtitle track editing
 * - TS (MPEG-TS / M2TS / MTS): Multi-audio supported; standard text subtitle editing unsupported
 * - AVI: Audio supported; embedded soft subtitle tracks unsupported
 * - FLV: Strictly single audio stream & no subtitle tracks (both audio & subtitle editing unsupported)
 */
export function getMediaFormatCapabilities(media: MediaInfo | null): MediaFormatCapabilities {
  if (!media) {
    return {
      container: '',
      supportsAudioEdit: true,
      supportsSubtitleEdit: true,
    };
  }

  const key = detectContainerKey(media);
  const container = formatContainerLabel(key);

  if (key === 'flv') {
    return {
      container,
      supportsAudioEdit: false,
      supportsSubtitleEdit: false,
    };
  }

  if (key === 'avi' || key === 'ts' || key === 'm2ts' || key === 'mts') {
    return {
      container,
      supportsAudioEdit: true,
      supportsSubtitleEdit: false,
    };
  }

  return {
    container,
    supportsAudioEdit: true,
    supportsSubtitleEdit: true,
  };
}
