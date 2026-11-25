import React from 'react';
import {
  X,
  RefreshCw,
  Download,
  CheckCircle2,
  Sparkles,
  AlertTriangle,
  ExternalLink,
  Loader2,
} from 'lucide-react';
import { openUrl } from '@tauri-apps/plugin-opener';
import type { UpdateCheckResult, UpdateProgressEvent } from '../types/media';
import { formatBytes } from '../utils/timecode';
import { useI18n } from '../i18n';

interface UpdateModalProps {
  open: boolean;
  currentVersion: string;
  autoUpdateEnabled: boolean;
  isChecking: boolean;
  checkResult: UpdateCheckResult | null;
  checkError: string | null;
  progress: UpdateProgressEvent | null;
  isBusyExporting: boolean;
  onClose: () => void;
  onToggleAutoUpdate: (enabled: boolean) => void;
  onCheckNow: () => void;
  onInstallNow: () => void;
  onCancelInstall: () => void;
}

export const UpdateModal: React.FC<UpdateModalProps> = ({
  open,
  currentVersion,
  autoUpdateEnabled,
  isChecking,
  checkResult,
  checkError,
  progress,
  isBusyExporting,
  onClose,
  onToggleAutoUpdate,
  onCheckNow,
  onInstallNow,
  onCancelInstall,
}) => {
  const { t } = useI18n();

  if (!open) return null;

  const isDownloading = progress?.stage === 'downloading';
  const isInstalling = progress?.stage === 'installing' || progress?.stage === 'restarting';
  const isUpdating = isDownloading || isInstalling;

  const handleOpenGithub = () => {
    const url = checkResult?.release_url || 'https://github.com/xzajyjs/HDRCut/releases';
    openUrl(url).catch(() => {});
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-6 select-none"
      onClick={() => {
        if (!isInstalling) onClose();
      }}
    >
      <div
        className="w-full max-w-[540px] max-h-[82vh] bg-[#0e121b] border border-white/[0.12] rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-white/[0.08] flex items-center justify-between bg-[#121723]">
          <div className="flex items-center gap-2.5">
            <RefreshCw
              className={`w-4 h-4 text-cyan-400 ${isChecking || isUpdating ? 'animate-spin' : ''}`}
            />
            <span className="text-sm font-semibold text-white">{t('upd.modalTitle')}</span>
          </div>
          {!isInstalling && (
            <button
              onClick={onClose}
              className="h-7 w-7 rounded-lg bg-white/[0.06] hover:bg-white/[0.14] text-zinc-300 flex items-center justify-center cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Auto-update toggle card */}
          <div className="p-3.5 rounded-xl bg-white/[0.03] border border-white/[0.07] flex items-center justify-between gap-4">
            <div className="space-y-0.5 min-w-0">
              <div className="text-xs font-semibold text-zinc-100">{t('upd.autoToggleTitle')}</div>
              <div className="text-[11px] text-zinc-400 leading-relaxed">
                {t('upd.autoToggleDesc')}
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={autoUpdateEnabled}
              onClick={() => onToggleAutoUpdate(!autoUpdateEnabled)}
              className={`w-10 h-5 rounded-full transition-colors relative shrink-0 cursor-pointer ${
                autoUpdateEnabled ? 'bg-emerald-500' : 'bg-zinc-700'
              }`}
            >
              <span
                className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                  autoUpdateEnabled ? 'translate-x-5 left-0.5' : 'translate-x-0 left-0.5'
                }`}
              />
            </button>
          </div>

          {/* Version summary */}
          <div className="p-4 rounded-xl bg-white/[0.025] border border-white/[0.07] space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-4 text-xs">
                <div>
                  <div className="text-[10px] text-zinc-500">{t('upd.currentVersion')}</div>
                  <div className="font-mono-num font-semibold text-zinc-100 mt-0.5">
                    v{currentVersion}
                  </div>
                </div>
                <div className="h-6 w-px bg-white/[0.08]" />
                <div>
                  <div className="text-[10px] text-zinc-500">{t('upd.latestVersion')}</div>
                  <div className="font-mono-num font-semibold text-cyan-300 mt-0.5">
                    {isChecking
                      ? '...'
                      : checkResult
                      ? `v${checkResult.latest_version}`
                      : t('upd.notCheckedYet')}
                  </div>
                </div>
              </div>

              <button
                type="button"
                disabled={isChecking || isUpdating}
                onClick={onCheckNow}
                className="h-8 px-3 rounded-lg bg-white/[0.07] hover:bg-white/[0.13] border border-white/[0.09] disabled:opacity-40 text-[11px] font-medium text-zinc-100 flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 text-cyan-400 ${isChecking ? 'animate-spin' : ''}`} />
                <span>{checkResult ? t('upd.recheck') : t('upd.checkNow')}</span>
              </button>
            </div>

            {/* Status banner */}
            {isChecking ? (
              <div className="text-xs text-cyan-300 flex items-center gap-2 pt-1">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>{t('upd.checking')}</span>
              </div>
            ) : checkError ? (
              <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/30 text-[11px] text-rose-300 flex items-start gap-2">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span className="break-all">{checkError}</span>
              </div>
            ) : checkResult ? (
              checkResult.has_update ? (
                <div className="p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-300 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 font-medium">
                    <Sparkles className="w-4 h-4 shrink-0" />
                    <span>{t('upd.newAvailable', { v: checkResult.latest_version })}</span>
                  </div>
                  {checkResult.asset_size > 0 && (
                    <span className="font-mono-num text-[11px] text-emerald-200/80">
                      {formatBytes(checkResult.asset_size)}
                    </span>
                  )}
                </div>
              ) : (
                <div className="text-xs text-emerald-400 flex items-center gap-1.5 pt-1">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>{t('upd.upToDate')}</span>
                </div>
              )
            ) : null}
          </div>

          {/* Release notes */}
          {checkResult && (
            <div className="space-y-1.5">
              <div className="text-[11px] font-semibold text-zinc-400">{t('upd.releaseNotes')}</div>
              <div className="max-h-48 overflow-y-auto p-3 rounded-xl bg-black/45 border border-white/[0.07] text-[11px] text-zinc-300 whitespace-pre-wrap leading-relaxed font-sans select-text">
                {checkResult.release_notes.trim() || t('upd.noNotes')}
              </div>
            </div>
          )}

          {/* Download / Install progress */}
          {progress && progress.stage !== 'cancelled' && (
            <div className="p-3.5 rounded-xl bg-[#111726] border border-cyan-500/30 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-cyan-200 font-medium flex items-center gap-2">
                  {progress.stage === 'error' ? (
                    <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
                  ) : (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-400" />
                  )}
                  <span>
                    {progress.stage === 'downloading'
                      ? t('upd.downloading')
                      : progress.stage === 'installing'
                      ? t('upd.installing')
                      : progress.stage === 'restarting'
                      ? t('upd.restarting')
                      : progress.message}
                  </span>
                </span>
                {progress.stage === 'downloading' && (
                  <span className="font-mono-num text-[11px] text-cyan-300">
                    {progress.percent.toFixed(0)}%
                    {progress.total_bytes > 0
                      ? ` · ${formatBytes(progress.downloaded_bytes)} / ${formatBytes(progress.total_bytes)}`
                      : ''}
                  </span>
                )}
              </div>
              {progress.stage !== 'error' && (
                <div className="h-2 rounded-full bg-white/[0.08] overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-cyan-400 to-emerald-400 transition-all duration-200"
                    style={{
                      width: `${
                        progress.stage === 'downloading'
                          ? Math.max(2, Math.min(100, progress.percent))
                          : 100
                      }%`,
                    }}
                  />
                </div>
              )}
            </div>
          )}

          {/* Export-in-progress warning */}
          {checkResult?.has_update && isBusyExporting && (
            <div className="text-[11px] text-amber-300 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <span>{t('upd.exportBlockedHint')}</span>
            </div>
          )}

          {/* Dev binary / non-self-update note */}
          {checkResult?.has_update && !checkResult.can_self_update && checkResult.self_update_note && (
            <div className="text-[11px] text-zinc-400">{checkResult.self_update_note}</div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-5 py-3.5 border-t border-white/[0.08] bg-[#10141f] flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={handleOpenGithub}
            className="h-8 px-3 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] text-[11px] text-zinc-300 flex items-center gap-1.5 cursor-pointer"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span>{t('upd.openGithub')}</span>
          </button>

          <div className="flex items-center gap-2">
            {isDownloading && (
              <button
                type="button"
                onClick={onCancelInstall}
                className="h-8 px-3 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 text-xs font-medium text-rose-200 cursor-pointer"
              >
                {t('upd.cancel')}
              </button>
            )}

            {checkResult?.has_update && checkResult.can_self_update && !isUpdating && (
              <button
                type="button"
                disabled={isBusyExporting}
                onClick={onInstallNow}
                className="h-8 px-4 rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-slate-950 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5 stroke-[2.3]" />
                <span>{t('upd.updateNow')}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
