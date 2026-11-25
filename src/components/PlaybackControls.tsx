import React, { useEffect, useRef, useState } from 'react';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Volume2,
  VolumeX,
  Scissors,
  Sparkles,
  Headphones,
  Subtitles,
} from 'lucide-react';
import type {
  EditableAudioTrack,
  EditableSubtitleTrack,
  PlayerStateEvent,
} from '../types/media';
import { formatTimecode } from '../utils/timecode';
import { useI18n } from '../i18n';

interface PlaybackControlsProps {
  disabled: boolean;
  playerState: PlayerStateEvent;
  duration: number;
  fps: number;
  isHdrVideo: boolean;
  draftIn: number | null;
  draftOut: number | null;
  audioTracks: EditableAudioTrack[];
  subtitleTracks: EditableSubtitleTrack[];
  onTogglePause: () => void;
  onSeek: (seconds: number, exact: boolean) => void;
  onSeekRelative: (delta: number) => void;
  onStepFrame: (forward: boolean) => void;
  onStepKeyframe: (direction: 'prev' | 'next') => void;
  onSetVolume: (vol: number) => void;
  onSetSpeed: (speed: number) => void;
  onToggleHdr: () => void;
  onSelectPreviewAudio: (aid: number) => void;
  onSelectPreviewSubtitle: (sid: number) => void;
  onMarkIn: () => void;
  onMarkOut: () => void;
  onCommitDraftRange: () => void;
}

const SPEEDS = [0.5, 1, 1.5, 2, 3];

function splitTimeToParts(seconds: number, fps: number): [string, string, string, string] {
  const safeFps = fps > 0.5 ? fps : 30;
  const safeSec = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const wholeSec = Math.floor(safeSec);
  const frac = safeSec - wholeSec;
  const maxFrame = Math.max(0, Math.round(safeFps) - 1);
  const ff = Math.min(maxFrame, Math.floor(frac * safeFps + 0.0001));

  const h = Math.floor(wholeSec / 3600);
  const m = Math.floor((wholeSec % 3600) / 60);
  const s = wholeSec % 60;

  return [
    String(h).padStart(2, '0'),
    String(m).padStart(2, '0'),
    String(s).padStart(2, '0'),
    String(ff).padStart(2, '0'),
  ];
}

export const PlaybackControls: React.FC<PlaybackControlsProps> = ({
  disabled,
  playerState,
  duration,
  fps,
  isHdrVideo,
  draftIn,
  draftOut,
  audioTracks,
  subtitleTracks,
  onTogglePause,
  onSeek,
  onSeekRelative,
  onStepFrame,
  onStepKeyframe,
  onSetVolume,
  onSetSpeed,
  onToggleHdr,
  onSelectPreviewAudio,
  onSelectPreviewSubtitle,
  onMarkIn,
  onMarkOut,
  onCommitDraftRange,
}) => {
  const { t } = useI18n();
  const effectiveDuration = duration || playerState.duration || 0;
  const effectiveFps = fps > 0.5 ? fps : 30;
  const muted = playerState.volume <= 0.1;

  // Segmented HH:MM:SS:FF jump-to-timecode editor state
  const [editingTime, setEditingTime] = useState(false);
  const [tcParts, setTcParts] = useState<[string, string, string, string]>(['00', '00', '00', '00']);
  const inputRefs = [
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
  ];
  const editorWrapRef = useRef<HTMLDivElement>(null);

  const openTimeEditor = () => {
    if (disabled) return;
    setTcParts(splitTimeToParts(playerState.time_pos, effectiveFps));
    setEditingTime(true);
  };

  // Focus & select "时 (HH)" immediately when entering edit mode
  useEffect(() => {
    if (editingTime) {
      requestAnimationFrame(() => {
        inputRefs[0].current?.focus();
        inputRefs[0].current?.select();
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingTime]);

  // Cancel editing if disabled (video closed)
  useEffect(() => {
    if (disabled) setEditingTime(false);
  }, [disabled]);

  const commitTimeJump = () => {
    const h = Math.max(0, parseInt(tcParts[0] || '0', 10) || 0);
    const m = Math.max(0, parseInt(tcParts[1] || '0', 10) || 0);
    const s = Math.max(0, parseInt(tcParts[2] || '0', 10) || 0);
    const maxFrame = Math.max(0, Math.round(effectiveFps) - 1);
    const f = Math.min(maxFrame, Math.max(0, parseInt(tcParts[3] || '0', 10) || 0));

    const targetSec = h * 3600 + m * 60 + s + f / effectiveFps;
    const clamped =
      effectiveDuration > 0 ? Math.min(effectiveDuration, Math.max(0, targetSec)) : Math.max(0, targetSec);
    setEditingTime(false);
    onSeek(clamped, true);
  };

  const handleSegmentChange = (idx: number, raw: string) => {
    const digits = raw.replace(/\D/g, '').slice(0, 2);
    setTcParts((prev) => {
      const next: [string, string, string, string] = [...prev] as [string, string, string, string];
      next[idx] = digits;
      return next;
    });
    // Auto-advance to the next segment once 2 digits are entered
    if (digits.length === 2 && idx < 3) {
      const nextInput = inputRefs[idx + 1].current;
      if (nextInput) {
        nextInput.focus();
        nextInput.select();
      }
    }
  };

  const handleSegmentKeyDown = (idx: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitTimeJump();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      setEditingTime(false);
      return;
    }
    if (e.key === 'Backspace' && tcParts[idx].length === 0 && idx > 0) {
      e.preventDefault();
      const prevInput = inputRefs[idx - 1].current;
      prevInput?.focus();
      prevInput?.select();
      return;
    }
    if ((e.key === ':' || e.key === '.' || e.key === 'ArrowRight') && idx < 3) {
      const input = e.currentTarget;
      if (e.key !== 'ArrowRight' || input.selectionStart === input.value.length) {
        e.preventDefault();
        const nextInput = inputRefs[idx + 1].current;
        nextInput?.focus();
        nextInput?.select();
      }
      return;
    }
    if (e.key === 'ArrowLeft' && idx > 0) {
      const input = e.currentTarget;
      if (input.selectionStart === 0) {
        e.preventDefault();
        const prevInput = inputRefs[idx - 1].current;
        prevInput?.focus();
        prevInput?.select();
      }
    }
  };

  const handleEditorBlur = (e: React.FocusEvent<HTMLDivElement>) => {
    const nextFocused = e.relatedTarget as Node | null;
    if (!nextFocused || !editorWrapRef.current?.contains(nextFocused)) {
      setEditingTime(false);
    }
  };

  const segmentLabels = [t('play.segH'), t('play.segM'), t('play.segS'), t('play.segF')];

  return (
    <div className="h-[48px] shrink-0 bg-[#10141d] border-t border-b border-white/[0.07] px-3 flex items-center justify-between gap-2">
      {/* Left: Transport & Frame/Keyframe Navigation */}
      <div className="flex items-center gap-1">
        <button
          disabled={disabled}
          onClick={() => onStepKeyframe('prev')}
          className="h-7 px-2 rounded-md hover:bg-white/[0.08] text-zinc-300 disabled:opacity-35 flex items-center gap-1 text-[11px] transition-colors cursor-pointer"
          title={t('play.prevKfTitle')}
        >
          <SkipBack className="w-3.5 h-3.5 text-amber-400" />
          <span className="hidden xl:inline text-[10px] text-amber-300/90">{t('play.kfShort')}</span>
        </button>

        <button
          disabled={disabled}
          onClick={() => onStepFrame(false)}
          className="h-7 w-7 rounded-md hover:bg-white/[0.08] text-zinc-300 disabled:opacity-35 flex items-center justify-center transition-colors cursor-pointer"
          title={t('play.prevFrameTitle')}
        >
          <ChevronLeft className="w-4 h-4" />
        </button>

        <button
          disabled={disabled}
          onClick={onTogglePause}
          className={`h-8 w-8 rounded-lg disabled:opacity-35 flex items-center justify-center shadow-md transition-colors cursor-pointer ${
            playerState.paused
              ? 'bg-rose-500 hover:bg-rose-400 text-white shadow-rose-500/25'
              : 'bg-cyan-500 hover:bg-cyan-400 text-slate-950 shadow-cyan-500/20'
          }`}
          title={t('play.playPauseTitle')}
        >
          {playerState.paused ? (
            <Play className="w-4 h-4 fill-white ml-0.5" />
          ) : (
            <Pause className="w-4 h-4 fill-slate-950" />
          )}
        </button>

        <button
          disabled={disabled}
          onClick={() => onStepFrame(true)}
          className="h-7 w-7 rounded-md hover:bg-white/[0.08] text-zinc-300 disabled:opacity-35 flex items-center justify-center transition-colors cursor-pointer"
          title={t('play.nextFrameTitle')}
        >
          <ChevronRight className="w-4 h-4" />
        </button>

        <button
          disabled={disabled}
          onClick={() => onStepKeyframe('next')}
          className="h-7 px-2 rounded-md hover:bg-white/[0.08] text-zinc-300 disabled:opacity-35 flex items-center gap-1 text-[11px] transition-colors cursor-pointer"
          title={t('play.nextKfTitle')}
        >
          <span className="hidden xl:inline text-[10px] text-amber-300/90">{t('play.kfShort')}</span>
          <SkipForward className="w-3.5 h-3.5 text-amber-400" />
        </button>

        <div className="hidden sm:flex items-center gap-0.5 ml-1">
          <button
            disabled={disabled}
            onClick={() => onSeekRelative(-5)}
            className="h-6 px-1.5 rounded bg-white/[0.05] hover:bg-white/[0.1] text-[10px] font-mono-num text-zinc-300 disabled:opacity-35 cursor-pointer"
          >
            -5s
          </button>
          <button
            disabled={disabled}
            onClick={() => onSeekRelative(5)}
            className="h-6 px-1.5 rounded bg-white/[0.05] hover:bg-white/[0.1] text-[10px] font-mono-num text-zinc-300 disabled:opacity-35 cursor-pointer"
          >
            +5s
          </button>
        </div>

        {/* High-precision clickable HH:MM:SS:FF timecode jump editor */}
        {editingTime ? (
          <div
            ref={editorWrapRef}
            onBlur={handleEditorBlur}
            className="ml-2 px-2 py-0.5 rounded-md bg-black/75 border border-cyan-400/70 font-mono-num text-[12px] text-cyan-200 flex items-center gap-0.5 shadow-sm shadow-cyan-500/20"
            title={t('play.timeEditorTitle')}
          >
            {[0, 1, 2, 3].map((idx) => (
              <React.Fragment key={idx}>
                <input
                  ref={inputRefs[idx]}
                  type="text"
                  inputMode="numeric"
                  maxLength={2}
                  value={tcParts[idx]}
                  placeholder={segmentLabels[idx]}
                  title={segmentLabels[idx]}
                  onFocus={(e) => e.currentTarget.select()}
                  onChange={(e) => handleSegmentChange(idx, e.target.value)}
                  onKeyDown={(e) => handleSegmentKeyDown(idx, e)}
                  className="w-[22px] bg-cyan-500/15 focus:bg-cyan-400/30 rounded text-center text-cyan-200 outline-none py-0.5 text-[12px] font-mono-num"
                />
                {idx < 3 && <span className="text-zinc-500 font-bold">:</span>}
              </React.Fragment>
            ))}
            <span className="text-[10px] text-zinc-500 pl-1.5">↵</span>
          </div>
        ) : (
          <button
            type="button"
            disabled={disabled}
            onClick={openTimeEditor}
            className="ml-2 px-2.5 py-1 rounded-md bg-black/40 hover:bg-black/65 border border-white/[0.06] hover:border-cyan-400/40 font-mono-num text-[12px] text-zinc-100 flex items-center gap-1.5 transition-colors cursor-pointer disabled:cursor-default disabled:hover:border-white/[0.06]"
            title={t('play.timeClickTitle')}
          >
            <span className="text-cyan-300">
              {splitTimeToParts(playerState.time_pos, effectiveFps).join(':')}
            </span>
            <span className="text-zinc-600">/</span>
            <span className="text-zinc-400">{formatTimecode(effectiveDuration, false)}</span>
          </button>
        )}
      </div>

      {/* Center: Instant In / Out Cutting Shortcuts */}
      <div className="flex items-center gap-1.5">
        <button
          disabled={disabled}
          onClick={onMarkIn}
          className={`h-7 px-2.5 rounded-md border text-[11px] font-medium transition-colors cursor-pointer disabled:opacity-35 ${
            draftIn !== null
              ? 'bg-cyan-500/20 border-cyan-400/50 text-cyan-200'
              : 'bg-white/[0.05] hover:bg-white/[0.1] border-white/[0.08] text-zinc-200'
          }`}
          title={t('play.markInTitle')}
        >
          {t('play.markIn')}{draftIn !== null ? ` ${formatTimecode(draftIn)}` : ''}
        </button>

        <button
          disabled={disabled}
          onClick={onMarkOut}
          className={`h-7 px-2.5 rounded-md border text-[11px] font-medium transition-colors cursor-pointer disabled:opacity-35 ${
            draftOut !== null
              ? 'bg-amber-500/20 border-amber-400/50 text-amber-200'
              : 'bg-white/[0.05] hover:bg-white/[0.1] border-white/[0.08] text-zinc-200'
          }`}
          title={t('play.markOutTitle')}
        >
          {t('play.markOut')}{draftOut !== null ? ` ${formatTimecode(draftOut)}` : ''}
        </button>

        {draftIn !== null && draftOut !== null && draftOut > draftIn && (
          <button
            onClick={onCommitDraftRange}
            className="h-7 px-2.5 rounded-md bg-rose-500 hover:bg-rose-400 text-white text-[11px] font-semibold flex items-center gap-1 shadow-md shadow-rose-500/25 transition-colors cursor-pointer"
          >
            <Scissors className="w-3 h-3" />
            <span>{t('play.addRange')}</span>
          </button>
        )}
      </div>

      {/* Right: Preview Audio Switcher, Subtitle Switcher, HDR Toggle, Speed, Volume */}
      <div className="flex items-center gap-2">
        {audioTracks.length > 1 && (
          <div className="relative flex items-center bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] rounded-md h-7 transition-colors">
            <Headphones className="w-3 h-3 text-cyan-400 shrink-0 ml-2 pointer-events-none" />
            <select
              disabled={disabled}
              value={playerState.aid}
              onChange={(e) => onSelectPreviewAudio(Number(e.target.value))}
              className="appearance-none bg-transparent h-full pl-1.5 pr-6 text-[11px] font-medium text-zinc-200 outline-none max-w-[132px] truncate cursor-pointer disabled:opacity-35"
              title={t('play.switchAudioTitle')}
            >
              {audioTracks.map((t) => (
                <option key={t.mpv_aid} value={t.mpv_aid} className="bg-[#111520] text-zinc-100">
                  #{t.mpv_aid} {t.title || t.codec_name}
                </option>
              ))}
            </select>
            <ChevronDown className="w-3 h-3 text-zinc-400 pointer-events-none absolute right-1.5" />
          </div>
        )}

        {subtitleTracks.length > 0 && (
          <div className="relative flex items-center bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] rounded-md h-7 transition-colors">
            <Subtitles className="w-3 h-3 text-sky-400 shrink-0 ml-2 pointer-events-none" />
            <select
              disabled={disabled}
              value={playerState.sid}
              onChange={(e) => onSelectPreviewSubtitle(Number(e.target.value))}
              className="appearance-none bg-transparent h-full pl-1.5 pr-6 text-[11px] font-medium text-zinc-200 outline-none max-w-[136px] truncate cursor-pointer disabled:opacity-35"
              title={t('play.switchSubTitle')}
            >
              <option value={0} className="bg-[#111520] text-zinc-400">
                {t('play.subOff')}
              </option>
              {subtitleTracks.map((s, i) => (
                <option key={s.id} value={s.mpv_sid} className="bg-[#111520] text-zinc-100">
                  #{i + 1} {s.title || s.codec_name}
                </option>
              ))}
            </select>
            <ChevronDown className="w-3 h-3 text-zinc-400 pointer-events-none absolute right-1.5" />
          </div>
        )}

        {isHdrVideo && (
          <button
            disabled={disabled}
            onClick={onToggleHdr}
            className={`h-7 px-2 rounded-md border text-[10px] font-semibold flex items-center gap-1 transition-colors cursor-pointer ${
              playerState.hdr_passthrough
                ? 'bg-amber-500/20 border-amber-400/50 text-amber-300'
                : 'bg-white/[0.05] border-white/[0.08] text-zinc-400'
            }`}
            title={t('play.hdrToggleTitle')}
          >
            <Sparkles className="w-3 h-3" />
            <span>{playerState.hdr_passthrough ? t('play.hdrPassthrough') : t('play.sdrTonemap')}</span>
          </button>
        )}

        <div className="relative flex items-center bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] rounded-md h-7 transition-colors">
          <select
            disabled={disabled}
            value={playerState.speed}
            onChange={(e) => onSetSpeed(Number(e.target.value))}
            className="appearance-none bg-transparent h-full pl-2.5 pr-6 text-[11px] font-mono-num font-medium text-zinc-200 outline-none cursor-pointer disabled:opacity-35"
            title={t('play.speedTitle')}
          >
            {SPEEDS.map((s) => (
              <option key={s} value={s} className="bg-[#111520] text-zinc-100">
                {s}x
              </option>
            ))}
          </select>
          <ChevronDown className="w-3 h-3 text-zinc-400 pointer-events-none absolute right-1.5" />
        </div>

        <div className="flex items-center gap-1.5">
          <button
            disabled={disabled}
            onClick={() => onSetVolume(muted ? 100 : 0)}
            className="text-zinc-400 hover:text-zinc-200 cursor-pointer disabled:opacity-35"
            title={t('play.muteTitle')}
          >
            {muted ? <VolumeX className="w-3.5 h-3.5 text-rose-400" /> : <Volume2 className="w-3.5 h-3.5" />}
          </button>
          <div
            className={`relative w-[76px] h-5 flex items-center select-none ${
              disabled ? 'opacity-35' : ''
            }`}
            title={`${Math.round(playerState.volume)}%`}
          >
            <div className="w-full h-1.5 rounded-full bg-white/[0.22] overflow-hidden pointer-events-none">
              <div
                className="h-full rounded-full bg-gradient-to-r from-sky-500 to-cyan-400"
                style={{
                  width: `${Math.max(0, Math.min(100, (playerState.volume / 130) * 100))}%`,
                }}
              />
            </div>
            <div
              className="w-3 h-3 rounded-full bg-white shadow-md shadow-black/60 ring-2 ring-cyan-400/70 pointer-events-none absolute top-1/2 -translate-y-1/2 -translate-x-1/2"
              style={{
                left: `${Math.max(0, Math.min(100, (playerState.volume / 130) * 100))}%`,
              }}
            />
            <input
              type="range"
              min={0}
              max={130}
              step={1}
              disabled={disabled}
              value={Math.round(playerState.volume)}
              onChange={(e) => onSetVolume(Number(e.target.value))}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
            />
          </div>
        </div>
      </div>
    </div>
  );
};
