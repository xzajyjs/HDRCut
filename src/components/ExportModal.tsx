import React, { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  Zap,
  SlidersHorizontal,
  X,
  Lock,
  Sparkles,
  Download,
  ChevronDown,
  RotateCcw,
  AlertTriangle,
  Cpu,
  Gauge,
  HardDrive,
  FolderOutput,
} from 'lucide-react';
import type {
  AdvancedContainerFormat,
  AdvancedExportConfig,
  AdvancedVideoCodec,
  AudioExportMode,
  ColorDepthMode,
  EncodingPreset,
  MediaInfo,
  RateControlMode,
  SubtitleExportMode,
  TonemapAlgorithm,
  VideoRotationMode,
} from '../types/media';
import { formatBytes, formatTimecode } from '../utils/timecode';
import { useI18n } from '../i18n';

interface ExportModalProps {
  open: boolean;
  media: MediaInfo | null;
  outputDir: string;
  losslessFormat: 'mkv' | 'mp4';
  expectedDurationSec: number;
  keptSegmentCount: number;
  isFullFile: boolean;
  smartCut: boolean;
  audioTrackCount: number;
  subtitleTrackCount: number;
  isBusy: boolean;
  onClose: () => void;
  onPickOutputDir: () => void;
  onLosslessFormatChange: (fmt: 'mkv' | 'mp4') => void;
  onStartLosslessExport: (outputPath: string, fmt: 'mkv' | 'mp4') => void;
  onStartAdvancedExport: (outputPath: string, config: AdvancedExportConfig) => void;
}

const CONTAINERS: Array<{ id: AdvancedContainerFormat; label: string; desc: string }> = [
  { id: 'mp4', label: 'MP4', desc: 'H.264 / HEVC / AV1' },
  { id: 'mkv', label: 'MKV', desc: 'All Codecs & Subs' },
  { id: 'mov', label: 'MOV', desc: 'QuickTime / ProRes' },
  { id: 'webm', label: 'WebM', desc: 'VP9 / AV1 + Opus' },
  { id: 'avi', label: 'AVI', desc: 'Legacy Compat' },
  { id: 'ts', label: 'TS', desc: 'MPEG-TS Stream' },
  { id: 'flv', label: 'FLV', desc: 'Flash / VOD' },
  { id: 'm4v', label: 'M4V', desc: 'Apple Video' },
];

const CODECS_BY_CONTAINER: Record<AdvancedContainerFormat, AdvancedVideoCodec[]> = {
  mp4: ['h264', 'hevc', 'av1'],
  mkv: ['h264', 'hevc', 'av1', 'vp9', 'prores'],
  mov: ['h264', 'hevc', 'prores'],
  webm: ['vp9', 'av1'],
  avi: ['h264', 'mpeg4'],
  ts: ['h264', 'hevc'],
  flv: ['h264'],
  m4v: ['h264', 'hevc'],
};

const CODEC_LABELS: Record<AdvancedVideoCodec, string> = {
  h264: 'H.264 / AVC',
  hevc: 'H.265 / HEVC',
  av1: 'AV1 (SVT-AV1)',
  vp9: 'VP9',
  prores: 'Apple ProRes 422 HQ',
  mpeg4: 'MPEG-4 Part 2',
};

const STANDARD_HEIGHTS = [2160, 1440, 1080, 720, 540, 480, 360];
const STANDARD_FPS = [120, 60, 50, 30, 29.97, 25, 24, 23.976, 15];
const BITRATE_PRESETS_MBPS = [2, 5, 8, 12, 20, 40];
const TARGET_SIZE_PRESETS_MB = [10, 25, 50, 100, 200, 500];

function evenDim(n: number): number {
  return Math.max(2, Math.round(n / 2) * 2);
}

function gcd(a: number, b: number): number {
  let x = Math.abs(Math.round(a));
  let y = Math.abs(Math.round(b));
  while (y !== 0) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x || 1;
}

function formatAspectRatio(w: number, h: number): string {
  if (w <= 0 || h <= 0) return '16:9';
  const g = gcd(w, h);
  const rw = Math.round(w / g);
  const rh = Math.round(h / g);
  if (rw <= 32 && rh <= 32) return `${rw}:${rh}`;
  return `${(w / h).toFixed(2)}:1`;
}

function getBaseNameWithoutExt(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot > 0 ? fileName.slice(0, dot) : fileName;
}

function getDirName(filePath: string): string {
  const idx = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  return idx > 0 ? filePath.slice(0, idx) : '';
}

function joinPath(dir: string, fileName: string): string {
  const sep = dir.includes('\\') ? '\\' : '/';
  const cleanDir = dir.replace(/[\\/]+$/, '');
  return `${cleanDir}${sep}${fileName}`;
}

function sanitizeStem(raw: string): string {
  return raw.replace(/[\\/:*?"<>|]/g, '_').trim();
}

function defaultAdvConfigForMedia(media: MediaInfo | null): AdvancedExportConfig {
  const isHdr = Boolean(media?.video?.is_hdr);
  return {
    container: 'mp4',
    video_codec: isHdr ? 'hevc' : 'h264',
    width: null,
    height: null,
    fps: null,
    rate_control: 'crf',
    crf: 20,
    video_bitrate_kbps: 10000,
    target_size_mb: 100,
    preset: 'medium',
    use_hw_accel: true,
    hdr_to_sdr: false,
    tonemap_algo: 'hable',
    color_depth: 'auto',
    audio_mode: 'aac_192',
    subtitle_mode: 'keep',
    faststart: true,
    rotation: 'none',
  };
}

export const ExportModal: React.FC<ExportModalProps> = ({
  open,
  media,
  outputDir,
  losslessFormat,
  expectedDurationSec,
  keptSegmentCount,
  isFullFile,
  smartCut,
  audioTrackCount,
  subtitleTrackCount,
  isBusy,
  onClose,
  onPickOutputDir,
  onLosslessFormatChange,
  onStartLosslessExport,
  onStartAdvancedExport,
}) => {
  const { t } = useI18n();
  const srcW = media?.video?.width || 1920;
  const srcH = media?.video?.height || 1080;
  const srcFps = media?.video?.fps && media.video.fps > 0.5 ? media.video.fps : 30;
  const srcIsHdr = Boolean(media?.video?.is_hdr);
  const aspectRatioLabel = useMemo(() => formatAspectRatio(srcW, srcH), [srcW, srcH]);

  const [mode, setMode] = useState<'lossless' | 'advanced'>('lossless');
  const [fileStem, setFileStem] = useState('');
  const [cfg, setCfg] = useState<AdvancedExportConfig>(() => defaultAdvConfigForMedia(media));
  const [customFpsInput, setCustomFpsInput] = useState('');
  const [fileAlreadyExists, setFileAlreadyExists] = useState(false);

  // Initialize sensible defaults every time modal opens
  useEffect(() => {
    if (!open || !media) return;
    setMode('lossless');
    setFileStem(`${getBaseNameWithoutExt(media.file_name)}-edit`);
    setCfg(defaultAdvConfigForMedia(media));
    setCustomFpsInput('');
  }, [open, media?.file_path]);

  const activeExt = mode === 'lossless' ? losslessFormat : cfg.container;
  const resolvedDir = outputDir || (media ? getDirName(media.file_path) : '');
  const cleanStem = sanitizeStem(fileStem);
  const fullOutputPath =
    resolvedDir && cleanStem ? joinPath(resolvedDir, `${cleanStem}.${activeExt}`) : '';

  const isSameAsSource = Boolean(
    media &&
      fullOutputPath &&
      fullOutputPath.toLowerCase() === media.file_path.toLowerCase()
  );

  // Reactively check whether target file already exists on disk (instant overwrite warning)
  useEffect(() => {
    if (!open || !fullOutputPath) {
      setFileAlreadyExists(false);
      return;
    }
    let cancelled = false;
    invoke<boolean[]>('check_files_exist', { paths: [fullOutputPath] })
      .then((res) => {
        if (!cancelled) setFileAlreadyExists(Boolean(res[0]));
      })
      .catch(() => {
        if (!cancelled) setFileAlreadyExists(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, fullOutputPath]);

  const handleAutoRename = async () => {
    if (!resolvedDir || !cleanStem) return;
    const baseWithoutIndex = cleanStem.replace(/\s*\(\d+\)$/, '');
    const candidates: string[] = [];
    for (let i = 2; i <= 50; i++) {
      candidates.push(joinPath(resolvedDir, `${baseWithoutIndex} (${i}).${activeExt}`));
    }
    try {
      const exists = await invoke<boolean[]>('check_files_exist', { paths: candidates });
      const freeIdx = exists.findIndex((e) => !e);
      if (freeIdx >= 0) {
        setFileStem(`${baseWithoutIndex} (${freeIdx + 2})`);
      } else {
        setFileStem(`${baseWithoutIndex}_${Date.now()}`);
      }
    } catch {
      setFileStem(`${baseWithoutIndex} (2)`);
    }
  };

  if (!open || !media) return null;

  const allowedCodecs = CODECS_BY_CONTAINER[cfg.container];
  const containerSupportsSubs = ['mkv', 'mp4', 'mov', 'm4v', 'webm'].includes(cfg.container);
  const isMp4Like = ['mp4', 'mov', 'm4v'].includes(cfg.container);
  const availableHeights = STANDARD_HEIGHTS.filter((h) => h < srcH);
  const availableFps = STANDARD_FPS.filter((f) => f < srcFps - 0.05);

  const curW = cfg.width ?? srcW;
  const curH = cfg.height ?? srcH;

  const handleContainerChange = (nextContainer: AdvancedContainerFormat) => {
    const nextCodecs = CODECS_BY_CONTAINER[nextContainer];
    let nextCodec = cfg.video_codec;
    if (!nextCodecs.includes(nextCodec)) {
      nextCodec = nextCodecs[0];
    }
    let nextAudio = cfg.audio_mode;
    if (nextContainer === 'webm' && nextAudio !== 'none' && nextAudio !== 'opus_160') {
      nextAudio = 'opus_160';
    } else if (nextContainer === 'flv' && nextAudio !== 'none' && !nextAudio.startsWith('aac_')) {
      nextAudio = 'aac_192';
    }
    setCfg((prev) => ({
      ...prev,
      container: nextContainer,
      video_codec: nextCodec,
      audio_mode: nextAudio,
    }));
  };

  const handleWidthChange = (rawVal: string) => {
    const v = parseInt(rawVal, 10);
    if (!Number.isFinite(v) || v <= 0) return;
    const clampedW = evenDim(Math.max(16, Math.min(7680, v)));
    const lockedH = evenDim((clampedW * srcH) / srcW);
    setCfg((prev) => ({ ...prev, width: clampedW, height: lockedH }));
  };

  const handleHeightChange = (rawVal: string) => {
    const v = parseInt(rawVal, 10);
    if (!Number.isFinite(v) || v <= 0) return;
    const clampedH = evenDim(Math.max(16, Math.min(4320, v)));
    const lockedW = evenDim((clampedH * srcW) / srcH);
    setCfg((prev) => ({ ...prev, width: lockedW, height: clampedH }));
  };

  const handlePresetHeight = (h: number | null) => {
    if (h === null) {
      setCfg((prev) => ({ ...prev, width: null, height: null }));
    } else {
      const ew = evenDim((h * srcW) / srcH);
      const eh = evenDim(h);
      setCfg((prev) => ({ ...prev, width: ew, height: eh }));
    }
  };

  // Proportional lossless output size estimate
  const estLosslessBytes =
    media.duration > 0.1
      ? Math.round(media.file_size * Math.min(1, expectedDurationSec / media.duration))
      : media.file_size;

  // Target-size bitrate budget calculation (mirrors Rust calculate_target_size_plan)
  const targetSizeAnalysis = (() => {
    if (mode !== 'advanced' || cfg.rate_control !== 'target_size') return null;
    const mb = cfg.target_size_mb ?? 0;
    if (!Number.isFinite(mb) || mb < 0.5) {
      return { valid: false, videoKbps: 0, audioKbps: 0 };
    }
    const dur = Math.max(0.5, expectedDurationSec);
    const usableKbits = (mb * 1024 * 1024 * 8 * 0.955) / 1000;
    const totalKbps = usableKbits / dur;
    const effectiveTracks = cfg.audio_mode === 'none' ? 0 : audioTrackCount;
    let audioKbps =
      effectiveTracks === 0
        ? 0
        : cfg.audio_mode === 'aac_320'
        ? 320
        : cfg.audio_mode === 'aac_192' || cfg.audio_mode === 'mp3_192'
        ? 192
        : cfg.audio_mode === 'opus_160'
        ? 160
        : cfg.audio_mode === 'aac_128'
        ? 128
        : cfg.audio_mode === 'flac'
        ? 900
        : 192;

    if (effectiveTracks > 0) {
      const maxPerTrack = Math.floor((totalKbps * 0.25) / effectiveTracks);
      if (audioKbps > maxPerTrack) {
        audioKbps = maxPerTrack >= 128 ? 128 : maxPerTrack >= 96 ? 96 : maxPerTrack >= 64 ? 64 : 48;
      }
    }
    const videoKbps = Math.floor(totalKbps - audioKbps * effectiveTracks);
    return {
      valid: videoKbps >= 80,
      videoKbps: Math.max(0, videoKbps),
      audioKbps,
    };
  })();

  const estimatedBytesForBitrate = (() => {
    if (mode !== 'advanced' || cfg.rate_control !== 'bitrate') return null;
    const vKbps = cfg.video_bitrate_kbps ?? 8000;
    const effectiveTracks = cfg.audio_mode === 'none' ? 0 : audioTrackCount;
    const aKbps =
      effectiveTracks === 0
        ? 0
        : cfg.audio_mode === 'aac_320'
        ? 320
        : cfg.audio_mode === 'aac_128'
        ? 128
        : cfg.audio_mode === 'opus_160'
        ? 160
        : cfg.audio_mode === 'flac'
        ? 900
        : 192;
    return (
      (((vKbps + aKbps * effectiveTracks) * 1000) / 8) *
      Math.max(0.5, expectedDurationSec) *
      1.02
    );
  })();

  const crfLabel = (() => {
    const c = cfg.crf ?? 20;
    if (c <= 17) return t('adv.crfUltra');
    if (c <= 22) return t('adv.crfHigh');
    if (c <= 27) return t('adv.crfBalanced');
    return t('adv.crfSmall');
  })();

  const canSubmit =
    !isBusy &&
    Boolean(fullOutputPath) &&
    !isSameAsSource &&
    (mode === 'lossless' ||
      cfg.rate_control !== 'target_size' ||
      Boolean(targetSizeAnalysis?.valid));

  const handleConfirm = () => {
    if (!canSubmit) return;
    if (mode === 'lossless') {
      onStartLosslessExport(fullOutputPath, losslessFormat);
    } else {
      onStartAdvancedExport(fullOutputPath, cfg);
    }
  };

  const videoCodecSummary = media.video
    ? `${media.video.codec_name.toUpperCase()} ${media.video.bit_depth ? `${media.video.bit_depth}bit` : ''} · ${
        media.video.is_hdr ? media.video.hdr_format || 'HDR' : 'SDR'
      }`
    : '—';

  const cutStrategyLabel = isFullFile
    ? t('exp.summaryFullFile')
    : smartCut
    ? t('exp.summarySmartCut')
    : t('exp.summaryKeyframe');

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-5 select-none"
      onClick={onClose}
    >
      <div
        className={`w-full max-w-[740px] max-h-[88vh] bg-[#0e121b] border rounded-2xl shadow-2xl flex flex-col overflow-hidden transition-colors ${
          mode === 'lossless' ? 'border-emerald-500/35' : 'border-cyan-500/35'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header + Unified 2-Tab Mode Switcher */}
        <div className="px-5 pt-4 pb-3 border-b border-white/[0.08] bg-[#141926] space-y-3 shrink-0">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div
                className={`w-8 h-8 rounded-xl border flex items-center justify-center shrink-0 ${
                  mode === 'lossless'
                    ? 'bg-emerald-500/15 border-emerald-400/40 text-emerald-300'
                    : 'bg-cyan-500/15 border-cyan-400/40 text-cyan-300'
                }`}
              >
                {mode === 'lossless' ? (
                  <Zap className="w-4 h-4" />
                ) : (
                  <SlidersHorizontal className="w-4 h-4" />
                )}
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-white truncate">
                  {t('exp.modalTitle')}
                </div>
                <div className="text-[11px] text-zinc-400 truncate">{t('exp.modalSubtitle')}</div>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {mode === 'advanced' && (
                <button
                  type="button"
                  onClick={() => {
                    setCfg(defaultAdvConfigForMedia(media));
                    setCustomFpsInput('');
                  }}
                  className="h-7 px-2.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-[11px] text-zinc-300 flex items-center gap-1 cursor-pointer"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>{t('adv.resetDefaults')}</span>
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                className="h-7 w-7 rounded-lg bg-white/[0.06] hover:bg-white/[0.14] text-zinc-300 flex items-center justify-center cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-black/45 border border-white/[0.08]">
            <button
              type="button"
              onClick={() => setMode('lossless')}
              className={`h-9 rounded-lg text-xs flex items-center justify-center gap-2 transition-all cursor-pointer ${
                mode === 'lossless'
                  ? 'bg-emerald-500 text-slate-950 font-bold shadow-md shadow-emerald-500/20'
                  : 'text-zinc-300 hover:bg-white/[0.06] font-medium'
              }`}
            >
              <Zap className="w-3.5 h-3.5 shrink-0" />
              <span>{t('exp.tabLossless')}</span>
              <span
                className={`px-1.5 py-0.5 rounded text-[10px] ${
                  mode === 'lossless' ? 'bg-black/20 text-slate-950' : 'bg-white/[0.08] text-zinc-400'
                }`}
              >
                {t('exp.tabLosslessBadge')}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setMode('advanced')}
              className={`h-9 rounded-lg text-xs flex items-center justify-center gap-2 transition-all cursor-pointer ${
                mode === 'advanced'
                  ? 'bg-gradient-to-r from-cyan-500 to-emerald-500 text-slate-950 font-bold shadow-md shadow-cyan-500/20'
                  : 'text-zinc-300 hover:bg-white/[0.06] font-medium'
              }`}
            >
              <SlidersHorizontal className="w-3.5 h-3.5 shrink-0" />
              <span>{t('exp.tabAdvanced')}</span>
              <span
                className={`hidden sm:inline px-1.5 py-0.5 rounded text-[10px] ${
                  mode === 'advanced' ? 'bg-black/20 text-slate-950' : 'bg-white/[0.08] text-zinc-400'
                }`}
              >
                {t('exp.tabAdvancedBadge')}
              </span>
            </button>
          </div>
        </div>

        {/* Scrollable Modal Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4 text-xs">
          {/* Shared Output Destination Block (File Name + Folder + Overwrite / Same-as-source Safety) */}
          <section className="p-3.5 rounded-xl bg-white/[0.03] border border-white/[0.08] space-y-2.5">
            <div className="grid grid-cols-12 gap-2 items-center">
              <label className="col-span-2 text-[11px] text-zinc-400">{t('exp.fileName')}</label>
              <div className="col-span-10 flex items-center gap-1.5">
                <input
                  type="text"
                  value={fileStem}
                  onChange={(e) => setFileStem(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleConfirm();
                    }
                  }}
                  placeholder={t('exp.fileNamePlaceholder')}
                  className="flex-1 h-8 px-2.5 rounded-lg bg-black/50 border border-white/[0.1] focus:border-emerald-400/60 text-xs text-zinc-100 placeholder:text-zinc-600 font-mono-num outline-none"
                />
                <span className="h-8 px-2.5 rounded-lg bg-white/[0.07] border border-white/[0.1] text-xs font-mono-num font-semibold text-cyan-300 flex items-center shrink-0">
                  .{activeExt}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-12 gap-2 items-center">
              <label className="col-span-2 text-[11px] text-zinc-400">{t('exp.saveTo')}</label>
              <div className="col-span-10 flex items-center gap-1.5">
                <div
                  className="flex-1 h-8 px-2.5 rounded-lg bg-black/35 border border-white/[0.08] text-[11px] font-mono-num text-zinc-300 flex items-center truncate"
                  title={resolvedDir}
                >
                  {resolvedDir || t('exp.noDirSelected')}
                </div>
                <button
                  type="button"
                  onClick={onPickOutputDir}
                  className="h-8 px-3 rounded-lg bg-white/[0.07] hover:bg-white/[0.14] border border-white/[0.1] text-[11px] text-zinc-200 flex items-center gap-1.5 shrink-0 cursor-pointer transition-colors"
                >
                  <FolderOutput className="w-3.5 h-3.5 text-emerald-400" />
                  <span>{t('exp.changeDir')}</span>
                </button>
              </div>
            </div>

            {isSameAsSource ? (
              <div className="flex items-center gap-1.5 text-[11px] text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-lg px-2.5 py-1.5">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                <span>{t('exp.sameAsSourceError')}</span>
              </div>
            ) : fileAlreadyExists ? (
              <div className="flex items-center justify-between gap-2 text-[11px] text-amber-200 bg-amber-500/10 border border-amber-500/30 rounded-lg px-2.5 py-1.5">
                <div className="flex items-center gap-1.5 min-w-0">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <span className="truncate">{t('exp.existsWarning')}</span>
                </div>
                <button
                  type="button"
                  onClick={() => void handleAutoRename()}
                  className="h-6 px-2 rounded bg-amber-500/20 hover:bg-amber-500/35 border border-amber-400/40 text-[10px] font-semibold text-amber-100 shrink-0 cursor-pointer"
                >
                  {t('exp.autoRename')}
                </button>
              </div>
            ) : null}
          </section>

          {/* TAB 1: LOSSLESS DIRECT EXPORT */}
          {mode === 'lossless' ? (
            <div className="space-y-4">
              <section className="space-y-2">
                <div className="text-[11px] font-medium text-zinc-400">
                  {t('exp.losslessFormat')}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() => onLosslessFormatChange('mkv')}
                    className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer ${
                      losslessFormat === 'mkv'
                        ? 'bg-emerald-500/[0.12] border-emerald-400/60 shadow-lg shadow-emerald-500/10'
                        : 'bg-black/30 border-white/[0.08] hover:bg-white/[0.05]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`text-xs font-bold font-mono-num ${
                          losslessFormat === 'mkv' ? 'text-emerald-200' : 'text-zinc-200'
                        }`}
                      >
                        MKV (Matroska)
                      </span>
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                          losslessFormat === 'mkv'
                            ? 'bg-emerald-500/25 text-emerald-200'
                            : 'bg-white/[0.07] text-zinc-400'
                        }`}
                      >
                        {t('exp.mkvBadge')}
                      </span>
                    </div>
                    <div className="text-[11px] text-zinc-400 mt-1.5 leading-relaxed">
                      {t('exp.mkvDesc')}
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => onLosslessFormatChange('mp4')}
                    className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer ${
                      losslessFormat === 'mp4'
                        ? 'bg-emerald-500/[0.12] border-emerald-400/60 shadow-lg shadow-emerald-500/10'
                        : 'bg-black/30 border-white/[0.08] hover:bg-white/[0.05]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`text-xs font-bold font-mono-num ${
                          losslessFormat === 'mp4' ? 'text-emerald-200' : 'text-zinc-200'
                        }`}
                      >
                        MP4 (MPEG-4)
                      </span>
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                          losslessFormat === 'mp4'
                            ? 'bg-emerald-500/25 text-emerald-200'
                            : 'bg-white/[0.07] text-zinc-400'
                        }`}
                      >
                        {t('exp.mp4Badge')}
                      </span>
                    </div>
                    <div className="text-[11px] text-zinc-400 mt-1.5 leading-relaxed">
                      {t('exp.mp4Desc')}
                    </div>
                  </button>
                </div>
              </section>

              {/* Lossless Direct Summary Card */}
              <section className="p-4 rounded-xl bg-emerald-500/[0.05] border border-emerald-500/25 space-y-2.5">
                <div className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="font-semibold text-emerald-300 flex items-center gap-1.5">
                    <Zap className="w-3.5 h-3.5" />
                    <span>{t('exp.summaryTitle')}</span>
                  </span>
                  <span className="font-mono-num text-emerald-200/90">{t('exp.summarySpeed')}</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-2 gap-x-5 text-[11px] text-zinc-300 pt-2 border-t border-white/[0.07]">
                  <div>
                    <span className="text-zinc-500">{t('exp.summarySegments')}：</span>
                    <span className="font-mono-num text-white">
                      {t('exp.summarySegmentsVal', {
                        n: keptSegmentCount,
                        dur: formatTimecode(expectedDurationSec, false),
                      })}
                    </span>
                  </div>
                  <div>
                    <span className="text-zinc-500">{t('exp.summaryStrategy')}：</span>
                    <span className="text-cyan-300 font-medium">{cutStrategyLabel}</span>
                  </div>
                  <div>
                    <span className="text-zinc-500">{t('exp.summaryVideo')}：</span>
                    <span className="font-mono-num text-white">{videoCodecSummary}</span>
                  </div>
                  <div>
                    <span className="text-zinc-500">{t('exp.summaryTracks')}：</span>
                    <span className="font-mono-num text-white">
                      {t('exp.summaryTracksVal', {
                        a: audioTrackCount,
                        s: subtitleTrackCount,
                      })}
                    </span>
                  </div>
                </div>
              </section>
            </div>
          ) : (
            /* TAB 2: ADVANCED TRANSCODE EXPORT */
            <div className="space-y-4">
              {/* 1. Container Format & Video Codec */}
              <section className="p-3.5 rounded-xl bg-white/[0.03] border border-white/[0.07] space-y-3">
                <div className="text-[11px] font-semibold text-cyan-300 uppercase tracking-wider">
                  {t('adv.secFormat')}
                </div>

                <div className="space-y-1.5">
                  <div className="text-[11px] text-zinc-400">{t('adv.container')}</div>
                  <div className="grid grid-cols-4 sm:grid-cols-8 gap-1.5">
                    {CONTAINERS.map((c) => {
                      const active = cfg.container === c.id;
                      return (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => handleContainerChange(c.id)}
                          className={`py-1.5 px-2 rounded-lg border text-center transition-colors cursor-pointer ${
                            active
                              ? 'bg-cyan-500/20 border-cyan-400/60 text-cyan-200 font-semibold'
                              : 'bg-black/35 hover:bg-white/[0.06] border-white/[0.08] text-zinc-300'
                          }`}
                          title={c.desc}
                        >
                          <div className="text-[11px] font-mono-num">{c.label}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <div className="text-[11px] text-zinc-400">{t('adv.videoCodec')}</div>
                    <div className="relative flex items-center h-8 rounded-lg bg-black/45 border border-white/[0.1] hover:border-white/[0.2]">
                      <select
                        value={cfg.video_codec}
                        onChange={(e) =>
                          setCfg((prev) => ({
                            ...prev,
                            video_codec: e.target.value as AdvancedVideoCodec,
                          }))
                        }
                        className="appearance-none bg-transparent w-full h-full pl-2.5 pr-7 text-[11px] font-medium text-zinc-100 outline-none cursor-pointer"
                      >
                        {allowedCodecs.map((codec) => (
                          <option key={codec} value={codec} className="bg-[#111520] text-zinc-100">
                            {CODEC_LABELS[codec]}
                          </option>
                        ))}
                      </select>
                      <ChevronDown className="w-3.5 h-3.5 text-zinc-400 pointer-events-none absolute right-2" />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <div className="text-[11px] text-zinc-400">{t('adv.speedPreset')}</div>
                    <div className="relative flex items-center h-8 rounded-lg bg-black/45 border border-white/[0.1] hover:border-white/[0.2]">
                      <select
                        value={cfg.preset}
                        onChange={(e) =>
                          setCfg((prev) => ({ ...prev, preset: e.target.value as EncodingPreset }))
                        }
                        className="appearance-none bg-transparent w-full h-full pl-2.5 pr-7 text-[11px] font-medium text-zinc-100 outline-none cursor-pointer"
                      >
                        <option value="ultrafast" className="bg-[#111520] text-zinc-100">
                          {t('adv.presetUltrafast')}
                        </option>
                        <option value="veryfast" className="bg-[#111520] text-zinc-100">
                          {t('adv.presetVeryfast')}
                        </option>
                        <option value="fast" className="bg-[#111520] text-zinc-100">
                          {t('adv.presetFast')}
                        </option>
                        <option value="medium" className="bg-[#111520] text-zinc-100">
                          {t('adv.presetMedium')}
                        </option>
                        <option value="slow" className="bg-[#111520] text-zinc-100">
                          {t('adv.presetSlow')}
                        </option>
                      </select>
                      <ChevronDown className="w-3.5 h-3.5 text-zinc-400 pointer-events-none absolute right-2" />
                    </div>
                  </div>
                </div>

                <label className="flex items-center gap-2 cursor-pointer text-[11px] text-zinc-300">
                  <input
                    type="checkbox"
                    checked={cfg.use_hw_accel}
                    onChange={(e) =>
                      setCfg((prev) => ({ ...prev, use_hw_accel: e.target.checked }))
                    }
                    className="w-3.5 h-3.5 accent-cyan-400 rounded cursor-pointer"
                  />
                  <Cpu className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                  <span>{t('adv.hwAccel')}</span>
                </label>
              </section>

              {/* 2. Resolution (Aspect Ratio Locked) & Frame Rate (Down-Only) & Rotation */}
              <section className="p-3.5 rounded-xl bg-white/[0.03] border border-white/[0.07] space-y-3.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold text-cyan-300 uppercase tracking-wider">
                    {t('adv.secGeometry')}
                  </span>
                  <span className="px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-400/35 text-[10px] font-medium text-amber-200 flex items-center gap-1">
                    <Lock className="w-2.5 h-2.5" />
                    {t('adv.aspectLocked', { ratio: aspectRatioLabel })}
                  </span>
                </div>

                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => handlePresetHeight(null)}
                      className={`h-7 px-2.5 rounded-lg border text-[11px] cursor-pointer transition-colors ${
                        cfg.width === null
                          ? 'bg-cyan-500/20 border-cyan-400/60 text-cyan-200 font-semibold'
                          : 'bg-black/35 hover:bg-white/[0.06] border-white/[0.08] text-zinc-300'
                      }`}
                    >
                      {t('adv.keepOriginal')} ({srcW}×{srcH})
                    </button>
                    {availableHeights.map((h) => {
                      const pw = evenDim((h * srcW) / srcH);
                      const active = cfg.height === h && cfg.width === pw;
                      return (
                        <button
                          key={h}
                          type="button"
                          onClick={() => handlePresetHeight(h)}
                          className={`h-7 px-2.5 rounded-lg border text-[11px] font-mono-num cursor-pointer transition-colors ${
                            active
                              ? 'bg-cyan-500/20 border-cyan-400/60 text-cyan-200 font-semibold'
                              : 'bg-black/35 hover:bg-white/[0.06] border-white/[0.08] text-zinc-300'
                          }`}
                          title={`${pw}×${h}`}
                        >
                          {h}p
                        </button>
                      );
                    })}
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] text-zinc-400">{t('adv.width')}</span>
                      <input
                        type="number"
                        min={16}
                        max={7680}
                        step={2}
                        value={curW}
                        onChange={(e) => handleWidthChange(e.target.value)}
                        className="w-24 h-7 px-2 rounded-md bg-black/50 border border-white/[0.1] focus:border-cyan-400/60 text-[11px] font-mono-num text-center text-zinc-100 outline-none"
                      />
                    </div>
                    <Lock className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] text-zinc-400">{t('adv.height')}</span>
                      <input
                        type="number"
                        min={16}
                        max={4320}
                        step={2}
                        value={curH}
                        onChange={(e) => handleHeightChange(e.target.value)}
                        className="w-24 h-7 px-2 rounded-md bg-black/50 border border-white/[0.1] focus:border-cyan-400/60 text-[11px] font-mono-num text-center text-zinc-100 outline-none"
                      />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1 border-t border-white/[0.06]">
                  <div className="sm:col-span-2 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-zinc-400">{t('adv.fps')}</span>
                      <span className="text-[10px] font-mono-num text-zinc-500">
                        {t('adv.fpsCapHint', { fps: media.video?.fps_display || srcFps.toFixed(0) })}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          setCfg((prev) => ({ ...prev, fps: null }));
                          setCustomFpsInput('');
                        }}
                        className={`h-7 px-2.5 rounded-lg border text-[11px] cursor-pointer ${
                          cfg.fps === null
                            ? 'bg-cyan-500/20 border-cyan-400/60 text-cyan-200 font-semibold'
                            : 'bg-black/35 hover:bg-white/[0.06] border-white/[0.08] text-zinc-300'
                        }`}
                      >
                        {t('adv.fpsOriginal', {
                          fps: media.video?.fps_display || srcFps.toFixed(0),
                        })}
                      </button>
                      {availableFps.map((f) => {
                        const active = cfg.fps !== null && Math.abs(cfg.fps - f) < 0.01;
                        return (
                          <button
                            key={f}
                            type="button"
                            onClick={() => {
                              setCfg((prev) => ({ ...prev, fps: f }));
                              setCustomFpsInput(String(f));
                            }}
                            className={`h-7 px-2 rounded-lg border text-[11px] font-mono-num cursor-pointer ${
                              active
                                ? 'bg-cyan-500/20 border-cyan-400/60 text-cyan-200 font-semibold'
                                : 'bg-black/35 hover:bg-white/[0.06] border-white/[0.08] text-zinc-300'
                            }`}
                          >
                            {f}
                          </button>
                        );
                      })}
                      <input
                        type="number"
                        min={1}
                        max={Math.floor(srcFps * 100) / 100}
                        step="0.5"
                        placeholder={t('adv.fpsCustom')}
                        value={customFpsInput}
                        onChange={(e) => {
                          setCustomFpsInput(e.target.value);
                          const v = parseFloat(e.target.value);
                          if (!Number.isFinite(v) || v < 1) {
                            setCfg((prev) => ({ ...prev, fps: null }));
                            return;
                          }
                          const clamped = Math.min(srcFps, Math.max(1, v));
                          setCfg((prev) => ({
                            ...prev,
                            fps: clamped >= srcFps - 0.01 ? null : Math.round(clamped * 1000) / 1000,
                          }));
                        }}
                        className="w-24 h-7 px-2 rounded-md bg-black/50 border border-white/[0.1] focus:border-cyan-400/60 text-[11px] font-mono-num text-center text-zinc-100 placeholder:text-zinc-500 outline-none"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <div className="text-[11px] text-zinc-400">{t('adv.rotation')}</div>
                    <div className="relative flex items-center h-7 rounded-lg bg-black/45 border border-white/[0.1]">
                      <select
                        value={cfg.rotation}
                        onChange={(e) =>
                          setCfg((prev) => ({
                            ...prev,
                            rotation: e.target.value as VideoRotationMode,
                          }))
                        }
                        className="appearance-none bg-transparent w-full h-full pl-2.5 pr-7 text-[11px] text-zinc-100 outline-none cursor-pointer"
                      >
                        <option value="none" className="bg-[#111520] text-zinc-100">
                          {t('adv.rotNone')}
                        </option>
                        <option value="cw90" className="bg-[#111520] text-zinc-100">
                          {t('adv.rotCw90')}
                        </option>
                        <option value="rot180" className="bg-[#111520] text-zinc-100">
                          {t('adv.rot180')}
                        </option>
                        <option value="ccw90" className="bg-[#111520] text-zinc-100">
                          {t('adv.rotCcw90')}
                        </option>
                        <option value="hflip" className="bg-[#111520] text-zinc-100">
                          {t('adv.rotHflip')}
                        </option>
                        <option value="vflip" className="bg-[#111520] text-zinc-100">
                          {t('adv.rotVflip')}
                        </option>
                      </select>
                      <ChevronDown className="w-3 h-3 text-zinc-400 pointer-events-none absolute right-2" />
                    </div>
                  </div>
                </div>
              </section>

              {/* 3. Rate Control: CRF / Bitrate / Target File Size <= MB */}
              <section className="p-3.5 rounded-xl bg-white/[0.03] border border-white/[0.07] space-y-3">
                <div className="text-[11px] font-semibold text-cyan-300 uppercase tracking-wider">
                  {t('adv.secRate')}
                </div>

                <div className="grid grid-cols-3 gap-1.5 p-1 rounded-xl bg-black/40 border border-white/[0.07]">
                  {(
                    [
                      { id: 'crf', label: t('adv.modeCrf'), icon: Sparkles },
                      { id: 'bitrate', label: t('adv.modeBitrate'), icon: Gauge },
                      { id: 'target_size', label: t('adv.modeTargetSize'), icon: HardDrive },
                    ] as const
                  ).map(({ id, label, icon: Icon }) => {
                    const active = cfg.rate_control === id;
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() =>
                          setCfg((prev) => ({ ...prev, rate_control: id as RateControlMode }))
                        }
                        className={`h-8 px-2 rounded-lg text-[11px] font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                          active
                            ? 'bg-cyan-500 text-slate-950 font-semibold shadow-sm'
                            : 'text-zinc-300 hover:bg-white/[0.06]'
                        }`}
                      >
                        <Icon className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate">{label}</span>
                      </button>
                    );
                  })}
                </div>

                {cfg.rate_control === 'crf' && (
                  <div className="space-y-2 pt-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-zinc-400">{t('adv.crfLabel')}</span>
                      <span className="font-mono-num font-semibold text-cyan-300">
                        CRF {cfg.crf ?? 20} · {crfLabel}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={14}
                      max={34}
                      step={1}
                      value={cfg.crf ?? 20}
                      onChange={(e) =>
                        setCfg((prev) => ({ ...prev, crf: parseInt(e.target.value, 10) }))
                      }
                      className="w-full accent-cyan-400 cursor-pointer"
                    />
                  </div>
                )}

                {cfg.rate_control === 'bitrate' && (
                  <div className="space-y-2 pt-1">
                    <div className="text-[11px] text-zinc-400">{t('adv.bitrateLabel')}</div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <div className="flex items-center gap-1.5">
                        <input
                          type="number"
                          min={0.2}
                          max={200}
                          step={0.5}
                          value={Math.round(((cfg.video_bitrate_kbps ?? 10000) / 1000) * 10) / 10}
                          onChange={(e) => {
                            const mbps = parseFloat(e.target.value);
                            if (Number.isFinite(mbps) && mbps > 0) {
                              setCfg((prev) => ({
                                ...prev,
                                video_bitrate_kbps: Math.round(mbps * 1000),
                              }));
                            }
                          }}
                          className="w-24 h-7 px-2 rounded-md bg-black/50 border border-white/[0.1] focus:border-cyan-400/60 text-[11px] font-mono-num text-center text-cyan-200 outline-none"
                        />
                        <span className="text-[11px] font-mono-num text-zinc-400">Mbps</span>
                      </div>
                      {BITRATE_PRESETS_MBPS.map((mbps) => {
                        const active = Math.abs((cfg.video_bitrate_kbps ?? 0) - mbps * 1000) < 50;
                        return (
                          <button
                            key={mbps}
                            type="button"
                            onClick={() =>
                              setCfg((prev) => ({ ...prev, video_bitrate_kbps: mbps * 1000 }))
                            }
                            className={`h-7 px-2 rounded-lg border text-[11px] font-mono-num cursor-pointer ${
                              active
                                ? 'bg-cyan-500/20 border-cyan-400/60 text-cyan-200 font-semibold'
                                : 'bg-black/35 hover:bg-white/[0.06] border-white/[0.08] text-zinc-300'
                            }`}
                          >
                            {mbps}M
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {cfg.rate_control === 'target_size' && (
                  <div className="space-y-2 pt-1">
                    <div className="text-[11px] text-zinc-400">{t('adv.targetSizeLabel')}</div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <div className="flex items-center gap-1.5">
                        <input
                          type="number"
                          min={1}
                          max={102400}
                          step={5}
                          value={cfg.target_size_mb ?? 100}
                          onChange={(e) => {
                            const mb = parseFloat(e.target.value);
                            setCfg((prev) => ({
                              ...prev,
                              target_size_mb: Number.isFinite(mb) ? mb : 0,
                            }));
                          }}
                          className="w-24 h-7 px-2 rounded-md bg-black/50 border border-emerald-400/40 focus:border-emerald-400 text-[11px] font-mono-num text-center text-emerald-200 outline-none"
                        />
                        <span className="text-[11px] font-mono-num text-zinc-400">MB</span>
                      </div>
                      {TARGET_SIZE_PRESETS_MB.map((mb) => {
                        const active = Math.abs((cfg.target_size_mb ?? 0) - mb) < 0.01;
                        return (
                          <button
                            key={mb}
                            type="button"
                            onClick={() => setCfg((prev) => ({ ...prev, target_size_mb: mb }))}
                            className={`h-7 px-2 rounded-lg border text-[11px] font-mono-num cursor-pointer ${
                              active
                                ? 'bg-emerald-500/20 border-emerald-400/60 text-emerald-200 font-semibold'
                                : 'bg-black/35 hover:bg-white/[0.06] border-white/[0.08] text-zinc-300'
                            }`}
                          >
                            {mb} MB
                          </button>
                        );
                      })}
                    </div>
                    {targetSizeAnalysis &&
                      (targetSizeAnalysis.valid ? (
                        <div className="text-[11px] text-emerald-300/90 font-mono-num">
                          {t('adv.targetSizeBreakdown', {
                            v: (targetSizeAnalysis.videoKbps / 1000).toFixed(2),
                            a: targetSizeAnalysis.audioKbps,
                          })}
                        </div>
                      ) : (
                        <div className="text-[11px] text-rose-300 flex items-center gap-1.5">
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                          <span>{t('adv.targetSizeTooSmall')}</span>
                        </div>
                      ))}
                  </div>
                )}
              </section>

              {/* 4. HDR -> SDR Tone Mapping & Color Depth */}
              <section className="p-3.5 rounded-xl bg-white/[0.03] border border-white/[0.07] space-y-3">
                <div className="text-[11px] font-semibold text-cyan-300 uppercase tracking-wider">
                  {t('adv.secColor')}
                </div>

                <div className="flex items-start justify-between gap-3 p-2.5 rounded-lg bg-black/35 border border-white/[0.07]">
                  <div className="space-y-0.5 min-w-0">
                    <div className="flex items-center gap-1.5 text-[11px] font-semibold text-zinc-100">
                      <Sparkles className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                      <span>{t('adv.hdrToSdr')}</span>
                    </div>
                    <div className="text-[10.5px] text-zinc-400 leading-relaxed">
                      {srcIsHdr
                        ? t('adv.hdrToSdrDescHdr', { fmt: media.video?.hdr_format || 'HDR' })
                        : t('adv.hdrToSdrDescSdr')}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setCfg((prev) => ({ ...prev, hdr_to_sdr: !prev.hdr_to_sdr }))}
                    className={`w-10 h-5 rounded-full transition-colors relative shrink-0 cursor-pointer mt-0.5 ${
                      cfg.hdr_to_sdr ? 'bg-amber-400' : 'bg-white/[0.15]'
                    }`}
                  >
                    <span
                      className={`w-4 h-4 rounded-full bg-white shadow absolute top-0.5 transition-all ${
                        cfg.hdr_to_sdr ? 'left-[22px]' : 'left-0.5'
                      }`}
                    />
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <div className="text-[11px] text-zinc-400">{t('adv.tonemapAlgo')}</div>
                    <div
                      className={`relative flex items-center h-8 rounded-lg bg-black/45 border border-white/[0.1] ${
                        !cfg.hdr_to_sdr ? 'opacity-45' : ''
                      }`}
                    >
                      <select
                        disabled={!cfg.hdr_to_sdr}
                        value={cfg.tonemap_algo}
                        onChange={(e) =>
                          setCfg((prev) => ({
                            ...prev,
                            tonemap_algo: e.target.value as TonemapAlgorithm,
                          }))
                        }
                        className="appearance-none bg-transparent w-full h-full pl-2.5 pr-7 text-[11px] text-zinc-100 outline-none cursor-pointer disabled:cursor-not-allowed"
                      >
                        <option value="hable" className="bg-[#111520] text-zinc-100">
                          {t('adv.tmHable')}
                        </option>
                        <option value="mobius" className="bg-[#111520] text-zinc-100">
                          {t('adv.tmMobius')}
                        </option>
                        <option value="reinhard" className="bg-[#111520] text-zinc-100">
                          {t('adv.tmReinhard')}
                        </option>
                        <option value="bt2390" className="bg-[#111520] text-zinc-100">
                          {t('adv.tmBt2390')}
                        </option>
                      </select>
                      <ChevronDown className="w-3.5 h-3.5 text-zinc-400 pointer-events-none absolute right-2" />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <div className="text-[11px] text-zinc-400">{t('adv.colorDepth')}</div>
                    <div className="relative flex items-center h-8 rounded-lg bg-black/45 border border-white/[0.1]">
                      <select
                        value={cfg.color_depth}
                        onChange={(e) =>
                          setCfg((prev) => ({
                            ...prev,
                            color_depth: e.target.value as ColorDepthMode,
                          }))
                        }
                        className="appearance-none bg-transparent w-full h-full pl-2.5 pr-7 text-[11px] text-zinc-100 outline-none cursor-pointer"
                      >
                        <option value="auto" className="bg-[#111520] text-zinc-100">
                          {t('adv.depthAuto')}
                        </option>
                        <option value="8bit" className="bg-[#111520] text-zinc-100">
                          {t('adv.depth8')}
                        </option>
                        <option value="10bit" className="bg-[#111520] text-zinc-100">
                          {t('adv.depth10')}
                        </option>
                      </select>
                      <ChevronDown className="w-3.5 h-3.5 text-zinc-400 pointer-events-none absolute right-2" />
                    </div>
                  </div>
                </div>
              </section>

              {/* 5. Audio, Subtitles & Container Optimization */}
              <section className="p-3.5 rounded-xl bg-white/[0.03] border border-white/[0.07] space-y-3">
                <div className="text-[11px] font-semibold text-cyan-300 uppercase tracking-wider">
                  {t('adv.secAudioSub')}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <div className="text-[11px] text-zinc-400">{t('adv.audioMode')}</div>
                    <div className="relative flex items-center h-8 rounded-lg bg-black/45 border border-white/[0.1]">
                      <select
                        value={cfg.audio_mode}
                        onChange={(e) =>
                          setCfg((prev) => ({
                            ...prev,
                            audio_mode: e.target.value as AudioExportMode,
                          }))
                        }
                        className="appearance-none bg-transparent w-full h-full pl-2.5 pr-7 text-[11px] text-zinc-100 outline-none cursor-pointer"
                      >
                        {cfg.container !== 'webm' && cfg.container !== 'flv' && (
                          <option value="copy" className="bg-[#111520] text-zinc-100">
                            {t('adv.audioCopy')}
                          </option>
                        )}
                        {cfg.container !== 'webm' && (
                          <>
                            <option value="aac_320" className="bg-[#111520] text-zinc-100">
                              AAC 320 kbps
                            </option>
                            <option value="aac_192" className="bg-[#111520] text-zinc-100">
                              AAC 192 kbps
                            </option>
                            <option value="aac_128" className="bg-[#111520] text-zinc-100">
                              AAC 128 kbps
                            </option>
                          </>
                        )}
                        {cfg.container !== 'flv' && (
                          <option value="opus_160" className="bg-[#111520] text-zinc-100">
                            Opus 160 kbps
                          </option>
                        )}
                        {cfg.container !== 'webm' && cfg.container !== 'flv' && (
                          <>
                            <option value="mp3_192" className="bg-[#111520] text-zinc-100">
                              MP3 192 kbps
                            </option>
                            <option value="flac" className="bg-[#111520] text-zinc-100">
                              FLAC Lossless
                            </option>
                          </>
                        )}
                        <option value="none" className="bg-[#111520] text-zinc-100">
                          {t('adv.audioNone')}
                        </option>
                      </select>
                      <ChevronDown className="w-3.5 h-3.5 text-zinc-400 pointer-events-none absolute right-2" />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <div className="text-[11px] text-zinc-400">{t('adv.subtitleMode')}</div>
                    <div
                      className={`relative flex items-center h-8 rounded-lg bg-black/45 border border-white/[0.1] ${
                        !containerSupportsSubs ? 'opacity-50' : ''
                      }`}
                    >
                      <select
                        disabled={!containerSupportsSubs}
                        value={containerSupportsSubs ? cfg.subtitle_mode : 'none'}
                        onChange={(e) =>
                          setCfg((prev) => ({
                            ...prev,
                            subtitle_mode: e.target.value as SubtitleExportMode,
                          }))
                        }
                        className="appearance-none bg-transparent w-full h-full pl-2.5 pr-7 text-[11px] text-zinc-100 outline-none cursor-pointer disabled:cursor-not-allowed"
                      >
                        <option value="keep" className="bg-[#111520] text-zinc-100">
                          {t('adv.subKeep', { n: subtitleTrackCount })}
                        </option>
                        <option value="none" className="bg-[#111520] text-zinc-100">
                          {t('adv.subNone')}
                        </option>
                      </select>
                      <ChevronDown className="w-3.5 h-3.5 text-zinc-400 pointer-events-none absolute right-2" />
                    </div>
                  </div>
                </div>

                {!containerSupportsSubs && subtitleTrackCount > 0 && (
                  <div className="text-[10.5px] text-amber-300/90">
                    {t('adv.subUnsupportedHint')}
                  </div>
                )}

                {isMp4Like && (
                  <label className="flex items-center gap-2 cursor-pointer text-[11px] text-zinc-300">
                    <input
                      type="checkbox"
                      checked={cfg.faststart}
                      onChange={(e) =>
                        setCfg((prev) => ({ ...prev, faststart: e.target.checked }))
                      }
                      className="w-3.5 h-3.5 accent-cyan-400 rounded cursor-pointer"
                    />
                    <span>{t('adv.faststart')}</span>
                  </label>
                )}
              </section>
            </div>
          )}
        </div>

        {/* Live Summary & Action Footer */}
        <div className="px-5 py-3.5 border-t border-white/[0.08] bg-[#10141f] flex items-center justify-between gap-3 shrink-0">
          {mode === 'lossless' ? (
            <div className="text-[11px] font-mono-num text-zinc-300 truncate flex items-center gap-1.5 min-w-0">
              <span className="text-emerald-300 font-semibold">
                {t('exp.footerLossless', { fmt: losslessFormat.toUpperCase() })}
              </span>
              <span className="text-zinc-600">·</span>
              <span>
                {srcW}×{srcH}
              </span>
              <span className="text-zinc-600">·</span>
              <span>{t('exp.footerOrigQuality')}</span>
              <span className="text-zinc-600">·</span>
              <span className="text-emerald-200">
                {t('adv.estSizeApprox', { size: formatBytes(estLosslessBytes) })}
              </span>
            </div>
          ) : (
            <div className="text-[11px] font-mono-num text-zinc-300 truncate flex items-center gap-1.5 min-w-0">
              <span className="px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-200 font-semibold uppercase">
                {cfg.container}
              </span>
              <span>
                {curW}×{curH}
              </span>
              <span className="text-zinc-600">·</span>
              <span>
                {cfg.fps ? `${cfg.fps}fps` : `${media.video?.fps_display || srcFps.toFixed(0)}fps`}
              </span>
              <span className="text-zinc-600">·</span>
              <span className="uppercase">{cfg.video_codec}</span>
              <span className="text-zinc-600">·</span>
              <span className={cfg.hdr_to_sdr ? 'text-amber-300' : ''}>
                {cfg.hdr_to_sdr ? 'HDR→SDR' : srcIsHdr ? 'HDR' : 'SDR'}
              </span>
              <span className="text-zinc-600">·</span>
              <span className="text-emerald-300 font-semibold">
                {t('adv.estSize')}:{' '}
                {cfg.rate_control === 'target_size'
                  ? t('adv.estSizeMax', { mb: cfg.target_size_mb ?? 0 })
                  : estimatedBytesForBitrate !== null
                  ? t('adv.estSizeApprox', { size: formatBytes(estimatedBytesForBitrate) })
                  : t('adv.estSizeAuto')}
              </span>
            </div>
          )}

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="h-8 px-3 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-xs text-zinc-300 cursor-pointer"
            >
              {t('adv.cancel')}
            </button>
            <button
              type="button"
              disabled={!canSubmit}
              onClick={handleConfirm}
              className={`h-8 px-4 rounded-lg disabled:opacity-35 disabled:cursor-not-allowed text-slate-950 text-xs font-bold flex items-center gap-1.5 shadow-lg cursor-pointer transition-colors ${
                mode === 'lossless'
                  ? 'bg-emerald-500 hover:bg-emerald-400 shadow-emerald-500/25'
                  : 'bg-gradient-to-r from-cyan-500 to-emerald-500 hover:from-cyan-400 hover:to-emerald-400 shadow-cyan-500/20'
              }`}
            >
              <Download className="w-3.5 h-3.5 stroke-[2.4]" />
              <span>
                {mode === 'lossless' ? t('exp.startLossless') : t('adv.startExport')}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
