import React, { useEffect, useMemo, useState } from 'react';
import {
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
import { formatBytes } from '../utils/timecode';
import { useI18n } from '../i18n';

interface AdvancedExportModalProps {
  open: boolean;
  media: MediaInfo | null;
  expectedDurationSec: number;
  audioTrackCount: number;
  subtitleTrackCount: number;
  isBusy: boolean;
  onClose: () => void;
  onConfirmExport: (config: AdvancedExportConfig) => void;
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

function defaultConfigForMedia(media: MediaInfo | null): AdvancedExportConfig {
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

export const AdvancedExportModal: React.FC<AdvancedExportModalProps> = ({
  open,
  media,
  expectedDurationSec,
  audioTrackCount,
  subtitleTrackCount,
  isBusy,
  onClose,
  onConfirmExport,
}) => {
  const { t } = useI18n();
  const srcW = media?.video?.width || 1920;
  const srcH = media?.video?.height || 1080;
  const srcFps = media?.video?.fps && media.video.fps > 0.5 ? media.video.fps : 30;
  const srcIsHdr = Boolean(media?.video?.is_hdr);
  const aspectRatioLabel = useMemo(() => formatAspectRatio(srcW, srcH), [srcW, srcH]);

  const [cfg, setCfg] = useState<AdvancedExportConfig>(() => defaultConfigForMedia(media));
  const [customFpsInput, setCustomFpsInput] = useState('');

  // Reset sensible defaults whenever opening for a different source video
  useEffect(() => {
    if (!open) return;
    setCfg(defaultConfigForMedia(media));
    setCustomFpsInput('');
  }, [open, media?.file_path]);

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

  // Compute live target-size breakdown & validation (mirrors Rust calculate_target_size_plan)
  const targetSizeAnalysis = (() => {
    if (cfg.rate_control !== 'target_size') return null;
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
    if (cfg.rate_control !== 'bitrate') return null;
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
    return (((vKbps + aKbps * effectiveTracks) * 1000) / 8) * Math.max(0.5, expectedDurationSec) * 1.02;
  })();

  const crfLabel = (() => {
    const c = cfg.crf ?? 20;
    if (c <= 17) return t('adv.crfUltra');
    if (c <= 22) return t('adv.crfHigh');
    if (c <= 27) return t('adv.crfBalanced');
    return t('adv.crfSmall');
  })();

  const canSubmit =
    !isBusy && (cfg.rate_control !== 'target_size' || Boolean(targetSizeAnalysis?.valid));

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-5 select-none"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[780px] max-h-[88vh] bg-[#0e121b] border border-cyan-500/30 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-white/[0.08] flex items-center justify-between bg-[#141926] shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-cyan-500/15 border border-cyan-400/35 flex items-center justify-center shrink-0">
              <SlidersHorizontal className="w-4 h-4 text-cyan-300" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-white truncate">{t('adv.title')}</div>
              <div className="text-[11px] text-zinc-400 truncate">{t('adv.subtitle')}</div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                setCfg(defaultConfigForMedia(media));
                setCustomFpsInput('');
              }}
              className="h-7 px-2.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-[11px] text-zinc-300 flex items-center gap-1 cursor-pointer"
            >
              <RotateCcw className="w-3 h-3" />
              <span>{t('adv.resetDefaults')}</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="h-7 w-7 rounded-lg bg-white/[0.06] hover:bg-white/[0.14] text-zinc-300 flex items-center justify-center cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Scrollable Config Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4 text-xs">
          {/* 1. Container Format & Video Codec */}
          <section className="p-3.5 rounded-xl bg-white/[0.03] border border-white/[0.07] space-y-3">
            <div className="text-[11px] font-semibold text-cyan-300 uppercase tracking-wider">
              {t('adv.secFormat')}
            </div>

            {/* 8 Mainstream Containers */}
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

            {/* Codec + Speed Preset */}
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
                onChange={(e) => setCfg((prev) => ({ ...prev, use_hw_accel: e.target.checked }))}
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

            {/* Resolution Presets + Linked W x H */}
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

            {/* Frame Rate (Down-Only) & Rotation */}
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
                    {t('adv.fpsOriginal', { fps: media.video?.fps_display || srcFps.toFixed(0) })}
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
              <div className="text-[10.5px] text-amber-300/90">{t('adv.subUnsupportedHint')}</div>
            )}

            {isMp4Like && (
              <label className="flex items-center gap-2 cursor-pointer text-[11px] text-zinc-300">
                <input
                  type="checkbox"
                  checked={cfg.faststart}
                  onChange={(e) => setCfg((prev) => ({ ...prev, faststart: e.target.checked }))}
                  className="w-3.5 h-3.5 accent-cyan-400 rounded cursor-pointer"
                />
                <span>{t('adv.faststart')}</span>
              </label>
            )}
          </section>
        </div>

        {/* Live Summary & Action Footer */}
        <div className="px-5 py-3.5 border-t border-white/[0.08] bg-[#10141f] flex items-center justify-between gap-3 shrink-0">
          <div className="text-[11px] font-mono-num text-zinc-300 truncate flex items-center gap-1.5 min-w-0">
            <span className="px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-200 font-semibold uppercase">
              {cfg.container}
            </span>
            <span>
              {curW}×{curH}
            </span>
            <span className="text-zinc-600">·</span>
            <span>{cfg.fps ? `${cfg.fps}fps` : `${media.video?.fps_display || srcFps.toFixed(0)}fps`}</span>
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
              onClick={() => onConfirmExport(cfg)}
              className="h-8 px-4 rounded-lg bg-gradient-to-r from-cyan-500 to-emerald-500 hover:from-cyan-400 hover:to-emerald-400 disabled:opacity-35 text-slate-950 text-xs font-bold flex items-center gap-1.5 shadow-lg shadow-cyan-500/20 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 stroke-[2.4]" />
              <span>{t('adv.startExport')}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
