import React, { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  FolderOpen,
  Film,
  Download,
  Sparkles,
  FolderOutput,
  Loader2,
  X,
  Info,
  Globe,
  RefreshCw,
  Undo2,
  Redo2,
  FolderKanban,
  Save,
  FileDown,
  FileUp,
  ChevronDown,
} from 'lucide-react';
import type { MediaInfo, ToolStatus } from '../types/media';
import { formatBitrate, formatBytes } from '../utils/timecode';
import { useI18n } from '../i18n';

interface TopBarProps {
  media: MediaInfo | null;
  toolStatus: ToolStatus | null;
  outputDir: string;
  exportFormat: 'mkv' | 'mp4';
  isExporting: boolean;
  isAnalyzing: boolean;
  canExport: boolean;
  canUndo: boolean;
  canRedo: boolean;
  currentProjectName: string | null;
  hasUpdateAvailable?: boolean;
  latestVersion?: string | null;
  isUpdatingApp?: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onSaveProject: () => void;
  onSaveProjectAs: () => void;
  onOpenProject: () => void;
  onOpenUpdateModal: () => void;
  onImportVideo: () => void;
  onCloseVideo: () => void;
  onOpenDetails: () => void;
  onPickOutputDir: () => void;
  onExportFormatChange: (fmt: 'mkv' | 'mp4') => void;
  onStartExport: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  media,
  toolStatus,
  outputDir,
  exportFormat,
  isExporting,
  isAnalyzing,
  canExport,
  canUndo,
  canRedo,
  currentProjectName,
  hasUpdateAvailable,
  latestVersion,
  isUpdatingApp,
  onUndo,
  onRedo,
  onSaveProject,
  onSaveProjectAs,
  onOpenProject,
  onOpenUpdateModal,
  onImportVideo,
  onCloseVideo,
  onOpenDetails,
  onPickOutputDir,
  onExportFormatChange,
  onStartExport,
}) => {
  const { locale, toggleLocale, t } = useI18n();
  const video = media?.video;
  const displayBitrate = formatBitrate(video?.bit_rate || media?.bit_rate || null);

  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const projectMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!projectMenuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (projectMenuRef.current && !projectMenuRef.current.contains(e.target as Node)) {
        setProjectMenuOpen(false);
      }
    };
    window.addEventListener('mousedown', onDocClick);
    return () => window.removeEventListener('mousedown', onDocClick);
  }, [projectMenuOpen]);

  return (
    <header className="h-[54px] shrink-0 bg-[#0d1017] border-b border-white/[0.07] px-3.5 flex items-center justify-between gap-2.5">
      {/* Left: Brand + Import + Media Info Strip */}
      <div className="flex items-center gap-2 min-w-0">
        <div className="flex items-center gap-2 pr-2 border-r border-white/[0.08] shrink-0">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-cyan-400 via-sky-500 to-amber-400 flex items-center justify-center shadow-lg shadow-cyan-500/20">
            <Film className="w-4 h-4 text-slate-950 stroke-[2.4]" />
          </div>
          <div className="leading-tight">
            <div className="text-[13px] font-bold tracking-tight text-white">HDRCut</div>
            <div className="text-[10px] text-zinc-500 font-medium">v1.6.6</div>
          </div>
        </div>

        <button
          onClick={onImportVideo}
          disabled={isAnalyzing}
          className="h-8 px-2.5 rounded-lg bg-white/[0.07] hover:bg-white/[0.12] active:bg-white/[0.15] border border-white/[0.09] text-xs font-medium text-zinc-100 flex items-center gap-1.5 transition-colors shrink-0 cursor-pointer disabled:opacity-50"
          title={t('top.importTooltip')}
        >
          {isAnalyzing ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-400" />
          ) : (
            <FolderOpen className="w-3.5 h-3.5 text-cyan-400" />
          )}
          <span>{media ? t('top.replaceVideo') : t('top.importVideo')}</span>
        </button>

        {media ? (
          <div className="flex items-center gap-1.5 min-w-0 overflow-hidden">
            <button
              onClick={onCloseVideo}
              disabled={isExporting}
              className="h-7 px-2 rounded-lg bg-white/[0.05] hover:bg-rose-500/20 border border-white/[0.08] hover:border-rose-500/40 text-[11px] text-zinc-300 hover:text-rose-200 flex items-center gap-1 shrink-0 transition-colors cursor-pointer disabled:opacity-40"
              title={t('top.closeTooltip')}
            >
              <X className="w-3.5 h-3.5" />
              <span>{t('top.close')}</span>
            </button>

            <span className="px-1.5 py-0.5 rounded bg-white/[0.06] text-[10px] font-mono-num text-zinc-300 shrink-0">
              {formatBytes(media.file_size)}
            </span>

            {video && (
              <>
                <span className="px-1.5 py-0.5 rounded bg-white/[0.06] text-[10px] font-mono-num text-zinc-300 shrink-0">
                  {video.width}×{video.height}
                </span>
                <span className="hidden 2xl:inline-block px-1.5 py-0.5 rounded bg-white/[0.06] text-[10px] font-mono-num text-zinc-300 shrink-0 uppercase">
                  {video.codec_name} {video.bit_depth ? `${video.bit_depth}bit` : ''} · {video.fps_display}fps
                </span>
                {displayBitrate && (
                  <span className="px-1.5 py-0.5 rounded bg-cyan-500/10 border border-cyan-500/25 text-[10px] font-mono-num text-cyan-300 shrink-0">
                    {displayBitrate}
                  </span>
                )}
                {video.is_hdr ? (
                  <span className="px-2 py-0.5 rounded-full bg-amber-500/20 border border-amber-400/45 text-[10px] font-semibold text-amber-300 flex items-center gap-1 shrink-0">
                    <Sparkles className="w-2.5 h-2.5" />
                    {video.hdr_format || 'HDR'}
                  </span>
                ) : (
                  <span className="px-1.5 py-0.5 rounded bg-white/[0.05] border border-white/[0.08] text-[10px] font-mono-num text-zinc-400 shrink-0">
                    SDR
                  </span>
                )}
              </>
            )}

            <button
              onClick={onOpenDetails}
              className="h-7 px-2 rounded-lg bg-white/[0.06] hover:bg-cyan-500/20 border border-white/[0.08] hover:border-cyan-400/40 text-[11px] text-zinc-200 hover:text-cyan-200 flex items-center gap-1 shrink-0 transition-colors cursor-pointer"
              title={t('top.detailsTooltip')}
            >
              <Info className="w-3.5 h-3.5 text-cyan-400" />
              <span>{t('top.details')}</span>
            </button>
          </div>
        ) : (
          <div className="hidden lg:flex items-center gap-2 text-[11px] text-zinc-500">
            <span>{t('top.supportedFormats')}</span>
            {toolStatus && !toolStatus.libmpv_available && (
              <span className="text-amber-400">{t('top.noLibmpv')}</span>
            )}
          </div>
        )}
      </div>

      {/* Right: Undo/Redo + Project Menu + Update + Language + Output Directory + Format + Export CTA */}
      <div className="flex items-center gap-1.5 shrink-0">
        {/* Global Undo / Redo */}
        <div className="h-8 p-0.5 rounded-lg bg-[#141824] border border-white/[0.08] flex items-center">
          <button
            type="button"
            disabled={!canUndo || isExporting}
            onClick={onUndo}
            className="h-full w-7 rounded-md hover:bg-white/[0.08] text-zinc-300 hover:text-white disabled:opacity-30 flex items-center justify-center transition-colors cursor-pointer"
            title={t('hist.undoTitle')}
          >
            <Undo2 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            disabled={!canRedo || isExporting}
            onClick={onRedo}
            className="h-full w-7 rounded-md hover:bg-white/[0.08] text-zinc-300 hover:text-white disabled:opacity-30 flex items-center justify-center transition-colors cursor-pointer"
            title={t('hist.redoTitle')}
          >
            <Redo2 className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Project Menu (native OS popup menu so it always floats above native libmpv video view) */}
        <div ref={projectMenuRef} className="relative">
          <button
            type="button"
            disabled={isExporting}
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const stripHint = (s: string) => s.replace(/\s*\([^)]*\)\s*$/, '').trim();
              invoke('show_project_menu', {
                x: rect.left,
                y: rect.bottom + 4,
                saveLabel: stripHint(t('proj.save')),
                saveAsLabel: stripHint(t('proj.saveAs')),
                openLabel: stripHint(t('proj.open')),
              }).catch(() => {
                // Fallback HTML popover when running outside native desktop shell
                setProjectMenuOpen((v) => !v);
              });
            }}
            className={`h-8 px-2.5 rounded-lg border text-[11px] font-medium flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-40 ${
              currentProjectName
                ? 'bg-sky-500/10 hover:bg-sky-500/20 border-sky-400/35 text-sky-200'
                : 'bg-[#141824] hover:bg-[#1a2030] border-white/[0.08] text-zinc-300 hover:text-white'
            }`}
            title={currentProjectName ? `${currentProjectName} · ${t('proj.menuTitle')}` : t('proj.menuTitle')}
          >
            <FolderKanban className="w-3.5 h-3.5 text-sky-400 shrink-0" />
            <span className="max-w-[84px] truncate">{currentProjectName || t('proj.menuBtn')}</span>
            <ChevronDown className="w-3 h-3 text-zinc-500 shrink-0" />
          </button>

          {projectMenuOpen && (
            <div className="absolute right-0 top-[38px] z-50 w-56 p-1.5 rounded-xl bg-[#131824] border border-white/[0.12] shadow-2xl space-y-0.5">
              <button
                type="button"
                onClick={() => {
                  setProjectMenuOpen(false);
                  onSaveProject();
                }}
                className="w-full h-8 px-2.5 rounded-lg hover:bg-white/[0.08] text-[11px] text-zinc-200 flex items-center gap-2 text-left cursor-pointer"
              >
                <Save className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span className="truncate">{t('proj.save')}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setProjectMenuOpen(false);
                  onSaveProjectAs();
                }}
                className="w-full h-8 px-2.5 rounded-lg hover:bg-white/[0.08] text-[11px] text-zinc-200 flex items-center gap-2 text-left cursor-pointer"
              >
                <FileDown className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                <span className="truncate">{t('proj.saveAs')}</span>
              </button>
              <div className="my-1 h-px bg-white/[0.07]" />
              <button
                type="button"
                onClick={() => {
                  setProjectMenuOpen(false);
                  onOpenProject();
                }}
                className="w-full h-8 px-2.5 rounded-lg hover:bg-white/[0.08] text-[11px] text-zinc-200 flex items-center gap-2 text-left cursor-pointer"
              >
                <FileUp className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span className="truncate">{t('proj.open')}</span>
              </button>
            </div>
          )}
        </div>

        {/* Update Button */}
        <button
          type="button"
          onClick={onOpenUpdateModal}
          className={`relative h-8 w-8 rounded-lg border flex items-center justify-center transition-colors cursor-pointer ${
            hasUpdateAvailable
              ? 'bg-emerald-500/15 hover:bg-emerald-500/25 border-emerald-400/50 text-emerald-300'
              : 'bg-[#141824] hover:bg-[#1a2030] border-white/[0.08] text-zinc-400 hover:text-zinc-100'
          }`}
          title={
            hasUpdateAvailable && latestVersion
              ? t('upd.topBtnNewVersion', { v: latestVersion })
              : t('upd.topBtnTitle')
          }
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isUpdatingApp ? 'animate-spin text-cyan-300' : ''}`} />
          {hasUpdateAvailable && (
            <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-400 ring-2 ring-[#0d1017]" />
          )}
        </button>

        {/* Language Toggle */}
        <button
          type="button"
          onClick={toggleLocale}
          className="h-8 px-2 rounded-lg bg-[#141824] hover:bg-[#1a2030] border border-white/[0.08] text-[11px] font-medium text-zinc-300 hover:text-white flex items-center gap-1 transition-colors cursor-pointer"
          title={t('app.langToggleTitle')}
        >
          <Globe className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
          <span className="font-mono-num">{locale === 'zh' ? '中文' : 'EN'}</span>
        </button>

        {/* Output Directory */}
        <button
          onClick={onPickOutputDir}
          className="h-8 px-2.5 rounded-lg bg-[#141824] hover:bg-[#1a2030] border border-white/[0.08] text-[11px] text-zinc-300 flex items-center gap-1.5 max-w-[155px] transition-colors cursor-pointer"
          title={outputDir || t('top.selectOutputDirTooltip')}
        >
          <FolderOutput className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          <span className="truncate">
            {outputDir
              ? outputDir.split(/[\\/]/).filter(Boolean).slice(-2).join('/')
              : t('top.selectOutputDir')}
          </span>
        </button>

        {/* Format Toggle */}
        <div
          className="h-8 p-0.5 rounded-lg bg-[#141824] border border-white/[0.08] flex items-center"
          title={t('top.exportFormatTooltip')}
        >
          <button
            type="button"
            disabled={isExporting}
            onClick={() => onExportFormatChange('mkv')}
            className={`h-full px-2 rounded-md text-[11px] font-mono-num font-semibold transition-colors cursor-pointer ${
              exportFormat === 'mkv'
                ? 'bg-cyan-500/25 text-cyan-200'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            MKV
          </button>
          <button
            type="button"
            disabled={isExporting}
            onClick={() => onExportFormatChange('mp4')}
            className={`h-full px-2 rounded-md text-[11px] font-mono-num font-semibold transition-colors cursor-pointer ${
              exportFormat === 'mp4'
                ? 'bg-cyan-500/25 text-cyan-200'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            MP4
          </button>
        </div>

        {/* Export CTA */}
        <button
          onClick={onStartExport}
          disabled={!canExport || isExporting}
          className="h-8 px-3 rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 disabled:cursor-not-allowed text-xs font-semibold text-slate-950 flex items-center gap-1.5 cursor-pointer"
        >
          {isExporting ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Download className="w-3.5 h-3.5 stroke-[2.3]" />
          )}
          <span>
            {isExporting
              ? t('top.exporting')
              : t('top.losslessExport', { fmt: exportFormat.toUpperCase() })}
          </span>
        </button>
      </div>
    </header>
  );
};
