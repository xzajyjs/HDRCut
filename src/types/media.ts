export interface ToolStatus {
  ffmpeg: string | null;
  ffprobe: string | null;
  mkvmerge: string | null;
  libmpv_available: boolean;
  libmpv_path: string | null;
}

export interface UpdateCheckResult {
  current_version: string;
  latest_version: string;
  has_update: boolean;
  release_name: string;
  release_notes: string;
  release_url: string;
  published_at: string;
  asset_name: string | null;
  asset_url: string | null;
  asset_size: number;
  can_self_update: boolean;
  self_update_note: string | null;
}

export interface UpdateProgressEvent {
  stage: 'downloading' | 'installing' | 'restarting' | 'error' | 'cancelled';
  percent: number;
  downloaded_bytes: number;
  total_bytes: number;
  message: string;
}

export interface VideoStreamInfo {
  stream_index: number;
  codec_name: string;
  codec_long_name: string;
  profile: string | null;
  level: number | null;
  width: number;
  height: number;
  sar: string | null;
  dar: string | null;
  fps: number;
  fps_display: string;
  pix_fmt: string | null;
  bit_depth: number | null;
  chroma_location: string | null;
  field_order: string | null;
  has_b_frames: number | null;
  color_space: string | null;
  color_transfer: string | null;
  color_primaries: string | null;
  color_range: string | null;
  time_base_den: number;
  master_display: string | null;
  max_cll: string | null;
  is_hdr: boolean;
  hdr_format: string | null;
  bit_rate: number | null;
}

export interface AudioStreamInfo {
  stream_index: number;
  audio_index: number;
  mpv_aid: number;
  codec_name: string;
  codec_long_name: string;
  profile: string | null;
  channels: number;
  channel_layout: string;
  sample_rate: number;
  bit_rate: number | null;
  language: string | null;
  title: string | null;
  is_default: boolean;
}

export interface SubtitleStreamInfo {
  stream_index: number;
  subtitle_index: number;
  mpv_sid: number;
  codec_name: string;
  codec_long_name: string;
  language: string | null;
  title: string | null;
  is_default: boolean;
  is_forced: boolean;
}

export interface MediaInfo {
  file_path: string;
  file_name: string;
  file_size: number;
  format_name: string;
  format_long_name: string;
  nb_streams: number;
  nb_chapters: number;
  encoder_tag: string | null;
  duration: number;
  bit_rate: number | null;
  video: VideoStreamInfo | null;
  audio_tracks: AudioStreamInfo[];
  subtitle_tracks: SubtitleStreamInfo[];
  keyframes: number[];
  keyframe_source: string;
}

export interface ExternalAudioInfo {
  file_path: string;
  file_name: string;
  codec_name: string;
  channels: number;
  channel_layout: string;
  sample_rate: number;
  bit_rate: number | null;
  language: string | null;
  title: string | null;
  duration: number;
}

export interface ExternalSubtitleInfo {
  file_path: string;
  file_name: string;
  codec_name: string;
  title: string;
  language: string | null;
}

export interface PlayerStateEvent {
  time_pos: number;
  duration: number;
  paused: boolean;
  volume: number;
  speed: number;
  aid: number;
  sid: number;
  eof_reached: boolean;
  hdr_passthrough: boolean;
}

export type CutMode = 'remove' | 'keep';

export interface CutRange {
  id: string;
  start: number;
  end: number;
  label?: string;
}

export interface EditableAudioTrack {
  id: string;
  source_kind: 'internal' | 'external';
  /** 0-based source audio stream index for internal tracks */
  audio_index: number;
  /** External file path when source_kind === 'external' */
  file_path?: string;
  mpv_aid: number;
  codec_name: string;
  channel_layout: string;
  sample_rate: number;
  bit_rate: number | null;
  language: string;
  title: string;
  original_title: string;
  enabled: boolean;
  is_default: boolean;
}

export interface EditableSubtitleTrack {
  id: string;
  source_kind: 'internal' | 'external';
  subtitle_index?: number;
  file_path?: string;
  mpv_sid: number;
  codec_name: string;
  codec_long_name: string;
  language: string;
  title: string;
  enabled: boolean;
  is_default: boolean;
  /** Time offset in seconds (+ = delay/later, - = advance/earlier) */
  delay_sec: number;
}

export interface TabSession {
  id: string;
  media: MediaInfo | null;
  isAnalyzing: boolean;
  playerError: string | null;
  playerState: PlayerStateEvent;
  activePanelTab: 'cut' | 'audio' | 'subtitle';
  cutMode: CutMode;
  ranges: CutRange[];
  draftIn: number | null;
  draftOut: number | null;
  smartCut: boolean;
  audioTracks: EditableAudioTrack[];
  mixedTracks: MixedAudioTrackConfig[];
  subtitleTracks: EditableSubtitleTrack[];
  outputDir: string;
  exportFormat: 'mkv' | 'mp4';
}

export interface MixedAudioTrackConfig {
  id: string;
  source_audio_indices: number[];
  gains_db: Record<number, number>;
  title: string;
  codec: 'flac' | 'pcm_s24le' | 'aac';
  normalize: boolean;
  enabled: boolean;
  is_default: boolean;
}

export interface ExportSegment {
  start: number;
  end: number;
}

export interface ExportProgressEvent {
  status: 'running' | 'done' | 'cancelled' | 'error';
  percent: number;
  out_time_sec: number;
  expected_duration_sec: number;
  speed: string;
  written_bytes: number;
  message: string;
  output_path: string;
}

export interface SavedProjectAudioTrack {
  source_kind: 'internal' | 'external';
  audio_index: number;
  file_path?: string;
  file_name?: string;
  title: string;
  language: string;
  enabled: boolean;
  is_default: boolean;
}

export interface SavedProjectSubtitleTrack {
  source_kind: 'internal' | 'external';
  subtitle_index?: number;
  file_path?: string;
  file_name?: string;
  title: string;
  language: string;
  enabled: boolean;
  is_default: boolean;
  delay_sec: number;
}

export interface SavedProjectTab {
  video_path: string | null;
  video_name: string | null;
  playback_time: number;
  volume: number;
  speed: number;
  hdr_passthrough: boolean;
  active_audio_aid: number;
  active_subtitle_sid: number;
  active_panel_tab: 'cut' | 'audio' | 'subtitle';
  cut_mode: CutMode;
  ranges: CutRange[];
  draft_in: number | null;
  draft_out: number | null;
  smart_cut: boolean;
  audio_tracks: SavedProjectAudioTrack[];
  mixed_tracks: MixedAudioTrackConfig[];
  subtitle_tracks: SavedProjectSubtitleTrack[];
  output_dir: string;
  export_format: 'mkv' | 'mp4';
}

export interface HDRCutProjectFile {
  format: 'hdrcut-project';
  schema_version: 1;
  app_version: string;
  saved_at: string;
  name: string;
  active_tab_index: number;
  tabs: SavedProjectTab[];
}

export interface MissingMediaItem {
  key: string;
  tabIndex: number;
  tabLabel: string;
  kind: 'video' | 'audio' | 'subtitle';
  trackIndex?: number;
  originalPath: string;
  fileName: string;
  relinkedPath: string | null;
  skipped: boolean;
}
