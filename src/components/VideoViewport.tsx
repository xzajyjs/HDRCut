import React, { useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Film, FolderOpen, FolderKanban, Sparkles, ShieldCheck, Layers } from 'lucide-react';
import type { MediaInfo } from '../types/media';
import { useI18n } from '../i18n';

interface VideoViewportProps {
  media: MediaInfo | null;
  isNativeReady: boolean;
  hideNativeView: boolean;
  isDraggingFile: boolean;
  errorMsg: string | null;
  onImportVideo: () => void;
  onOpenProject: () => void;
  onTogglePause: () => void;
}

/**
 * Tracks exact viewport bounding rect via ResizeObserver and syncs it to
 * the native hardware-accelerated libmpv NSView / HWND child surface.
 * Because the native view uses hit-test passthrough, clicks and drag-and-drop
 * cleanly work right here!
 */
export const VideoViewport: React.FC<VideoViewportProps> = ({
  media,
  isNativeReady,
  hideNativeView,
  isDraggingFile,
  errorMsg,
  onImportVideo,
  onOpenProject,
  onTogglePause,
}) => {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let rafId = 0;
    const syncBounds = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        if (!containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        const visible =
          Boolean(media) && isNativeReady && !hideNativeView && rect.width > 4 && rect.height > 4;
        // Inset by 4px while dragging a file so the glowing blue perimeter halo stays clearly visible around live video
        const inset = isDraggingFile ? 4 : 0;
        invoke('player_set_bounds', {
          x: rect.left + inset,
          y: rect.top + inset,
          width: Math.max(0, rect.width - inset * 2),
          height: Math.max(0, rect.height - inset * 2),
          viewportHeight: window.innerHeight,
          scaleFactor: window.devicePixelRatio || 1,
          visible,
        }).catch(() => {});
      });
    };

    syncBounds();

    const ro = new ResizeObserver(syncBounds);
    ro.observe(el);
    window.addEventListener('resize', syncBounds);
    window.addEventListener('scroll', syncBounds, true);

    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
      window.removeEventListener('resize', syncBounds);
      window.removeEventListener('scroll', syncBounds, true);
    };
  }, [media, isNativeReady, hideNativeView, isDraggingFile]);

  return (
    <div
      ref={containerRef}
      onClick={() => {
        if (media) onTogglePause();
      }}
      className={`relative flex-1 min-h-[240px] overflow-hidden flex items-center justify-center transition-all duration-150 ${
        isDraggingFile
          ? 'bg-sky-950/35 ring-4 ring-inset ring-sky-400 shadow-[inset_0_0_54px_rgba(56,189,248,0.55)]'
          : 'bg-black'
      }`}
    >
      {/* Glowing blue perimeter aura when dragging a video or .hdrcut project over the viewport */}
      {isDraggingFile && (
        <div className="pointer-events-none absolute inset-0 z-20 border-2 border-cyan-300/95 shadow-[inset_0_0_40px_rgba(34,211,238,0.5),inset_0_0_12px_rgba(56,189,248,0.85)] animate-pulse" />
      )}

      {!media ? (
        <div className="relative z-10 flex flex-col items-center justify-center text-center px-6 max-w-lg select-none">
          <div
            className={`w-16 h-16 rounded-2xl border flex items-center justify-center mb-5 shadow-2xl transition-all ${
              isDraggingFile
                ? 'bg-sky-500/25 border-cyan-300/70 shadow-cyan-400/40 scale-105'
                : 'bg-gradient-to-br from-cyan-500/20 via-sky-500/10 to-amber-500/20 border-white/[0.1] shadow-cyan-500/10'
            }`}
          >
            <Film className="w-8 h-8 text-cyan-400" />
          </div>
          <h2 className="text-lg font-semibold text-white tracking-tight mb-2">
            {t('viewport.dropTitle')}
          </h2>
          {isDraggingFile ? (
            <div className="h-10 flex items-center text-xs font-medium text-cyan-300 mb-1">
              {t('viewport.dropHoverHint')}
            </div>
          ) : (
            <div className="flex items-center justify-center gap-3 mt-3">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onImportVideo();
                }}
                className="h-10 px-5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-semibold flex items-center gap-2 transition-colors cursor-pointer"
              >
                <FolderOpen className="w-4 h-4 stroke-[2.3]" />
                <span>{t('viewport.selectFile')}</span>
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenProject();
                }}
                className="h-10 px-5 rounded-xl bg-white/[0.07] hover:bg-white/[0.13] border border-white/[0.12] hover:border-sky-400/45 text-zinc-100 text-xs font-semibold flex items-center gap-2 transition-colors cursor-pointer"
              >
                <FolderKanban className="w-4 h-4 text-sky-400 stroke-[2.2]" />
                <span>{t('viewport.openProject')}</span>
              </button>
            </div>
          )}

          <div className="grid grid-cols-3 gap-3 mt-8 w-full text-center">
            <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.06] flex flex-col items-center">
              <Sparkles className="w-4 h-4 text-amber-400 mb-1.5" />
              <div className="text-[11px] font-medium text-zinc-200">{t('viewport.cardHdr')}</div>
            </div>
            <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.06] flex flex-col items-center">
              <ShieldCheck className="w-4 h-4 text-emerald-400 mb-1.5" />
              <div className="text-[11px] font-medium text-zinc-200">{t('viewport.cardLossless')}</div>
            </div>
            <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.06] flex flex-col items-center">
              <Layers className="w-4 h-4 text-cyan-400 mb-1.5" />
              <div className="text-[11px] font-medium text-zinc-200">{t('viewport.cardAudio')}</div>
            </div>
          </div>
        </div>
      ) : errorMsg ? (
        <div className="text-center px-6 max-w-md">
          <div className="text-sm font-medium text-amber-400 mb-1">{t('viewport.playerNotice')}</div>
          <div className="text-xs text-zinc-400 leading-relaxed">{errorMsg}</div>
        </div>
      ) : (
        <div className="text-[11px] text-zinc-600 pointer-events-none">
          {t('viewport.rendering')}
        </div>
      )}
    </div>
  );
};
