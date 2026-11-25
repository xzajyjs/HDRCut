import React, { useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Film, FolderOpen, Sparkles, ShieldCheck, Layers } from 'lucide-react';
import type { MediaInfo } from '../types/media';

interface VideoViewportProps {
  media: MediaInfo | null;
  isNativeReady: boolean;
  hideNativeView: boolean;
  errorMsg: string | null;
  onImportVideo: () => void;
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
  errorMsg,
  onImportVideo,
  onTogglePause,
}) => {
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
        const visible = Boolean(media) && isNativeReady && !hideNativeView && rect.width > 4 && rect.height > 4;
        invoke('player_set_bounds', {
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height,
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
  }, [media, isNativeReady, hideNativeView]);

  return (
    <div
      ref={containerRef}
      onClick={() => {
        if (media) onTogglePause();
      }}
      className="relative flex-1 min-h-[240px] bg-black overflow-hidden flex items-center justify-center"
    >
      {!media ? (
        <div className="flex flex-col items-center justify-center text-center px-6 max-w-lg select-none">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-cyan-500/20 via-sky-500/10 to-amber-500/20 border border-white/[0.1] flex items-center justify-center mb-5 shadow-2xl shadow-cyan-500/10">
            <Film className="w-8 h-8 text-cyan-400" />
          </div>
          <h2 className="text-lg font-semibold text-white tracking-tight mb-5">
            拖入或导入视频文件
          </h2>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onImportVideo();
            }}
            className="h-10 px-5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-semibold flex items-center gap-2 cursor-pointer"
          >
            <FolderOpen className="w-4 h-4 stroke-[2.3]" />
            <span>选择视频文件</span>
          </button>

          <div className="grid grid-cols-3 gap-3 mt-8 w-full text-center">
            <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.06] flex flex-col items-center">
              <Sparkles className="w-4 h-4 text-amber-400 mb-1.5" />
              <div className="text-[11px] font-medium text-zinc-200">真 HDR 硬解引擎</div>
            </div>
            <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.06] flex flex-col items-center">
              <ShieldCheck className="w-4 h-4 text-emerald-400 mb-1.5" />
              <div className="text-[11px] font-medium text-zinc-200">绝对零重编码</div>
            </div>
            <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.06] flex flex-col items-center">
              <Layers className="w-4 h-4 text-cyan-400 mb-1.5" />
              <div className="text-[11px] font-medium text-zinc-200">多音轨混音命名</div>
            </div>
          </div>
        </div>
      ) : errorMsg ? (
        <div className="text-center px-6 max-w-md">
          <div className="text-sm font-medium text-amber-400 mb-1">视频播放器提示</div>
          <div className="text-xs text-zinc-400 leading-relaxed">{errorMsg}</div>
        </div>
      ) : (
        <div className="text-[11px] text-zinc-600 pointer-events-none">
          正在由原生 libmpv HDR 引擎渲染画面...
        </div>
      )}
    </div>
  );
};
