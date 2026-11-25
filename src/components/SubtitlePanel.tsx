import React, { useState } from 'react';
import {
  Subtitles,
  Eye,
  EyeOff,
  Download,
  FolderDown,
  FilePlus2,
  Star,
  Trash2,
  Clock,
  RotateCcw,
  CopyCheck,
} from 'lucide-react';
import type { EditableSubtitleTrack } from '../types/media';
import { useI18n } from '../i18n';

interface SubtitlePanelProps {
  hasMedia: boolean;
  subtitles: EditableSubtitleTrack[];
  activePreviewSid: number;
  isBusy: boolean;
  onPreviewSubtitle: (mpvSid: number) => void;
  onUpdateSubtitle: (id: string, patch: Partial<EditableSubtitleTrack>) => void;
  onToggleAllSubtitles: (enabled: boolean) => void;
  onSetSubtitleDelay: (id: string, delaySec: number) => void;
  onBatchShiftSubtitles: (deltaSec: number) => void;
  onBatchSetSubtitlesDelay: (delaySec: number) => void;
  onSetDefaultSubtitle: (id: string) => void;
  onDeleteSubtitle: (id: string) => void;
  onDeleteCheckedSubtitles: () => void;
  onImportSubtitle: () => void;
  onExportSingleSubtitle: (sub: EditableSubtitleTrack) => void;
  onExportBatchSubtitles: () => void;
}

export const SubtitlePanel: React.FC<SubtitlePanelProps> = ({
  hasMedia,
  subtitles,
  activePreviewSid,
  isBusy,
  onPreviewSubtitle,
  onUpdateSubtitle,
  onToggleAllSubtitles,
  onSetSubtitleDelay,
  onBatchShiftSubtitles,
  onBatchSetSubtitlesDelay,
  onSetDefaultSubtitle,
  onDeleteSubtitle,
  onDeleteCheckedSubtitles,
  onImportSubtitle,
  onExportSingleSubtitle,
  onExportBatchSubtitles,
}) => {
  const { t } = useI18n();
  const [batchDelayText, setBatchDelayText] = useState('0');
  const internalEnabledCount = subtitles.filter(
    (s) => s.enabled && s.source_kind === 'internal'
  ).length;
  const checkedSubs = subtitles.filter((s) => s.enabled);
  const totalEnabled = checkedSubs.length;
  const allChecked = subtitles.length > 0 && totalEnabled === subtitles.length;
  const anyCheckedHasDelay = checkedSubs.some((s) => Math.abs(s.delay_sec) > 0.001);

  const applyBatchInput = () => {
    if (totalEnabled === 0) return;
    const v = parseFloat(batchDelayText);
    if (!Number.isFinite(v)) return;
    onBatchSetSubtitlesDelay(Math.round(v * 100) / 100);
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header actions */}
      <div className="p-3 border-b border-white/[0.06] space-y-2 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <label
            className="flex items-center gap-2 cursor-pointer"
            title={t('sub.toggleAllTitle')}
          >
            {subtitles.length > 0 && (
              <input
                type="checkbox"
                checked={allChecked}
                onChange={(e) => onToggleAllSubtitles(e.target.checked)}
                className="w-3.5 h-3.5 accent-emerald-400 rounded cursor-pointer"
              />
            )}
            <span className="text-xs font-semibold text-zinc-100">
              {t('sub.header', { enabled: totalEnabled, total: subtitles.length })}
            </span>
          </label>
          {activePreviewSid > 0 && hasMedia && (
            <button
              onClick={() => onPreviewSubtitle(0)}
              className="h-6 px-2 rounded-md bg-white/[0.06] hover:bg-white/[0.12] text-[10px] text-zinc-300 flex items-center gap-1 cursor-pointer"
              title={t('sub.hidePreviewTitle')}
            >
              <EyeOff className="w-3 h-3 text-zinc-400" />
              <span>{t('sub.hidePreview')}</span>
            </button>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <button
            disabled={!hasMedia || isBusy}
            onClick={onImportSubtitle}
            className="flex-1 h-7 px-2 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-400/35 disabled:opacity-40 text-[11px] font-medium text-cyan-200 flex items-center justify-center gap-1 transition-colors cursor-pointer"
          >
            <FilePlus2 className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">{t('sub.importBtn')}</span>
          </button>

          <button
            disabled={!hasMedia || internalEnabledCount === 0 || isBusy}
            onClick={onExportBatchSubtitles}
            className="flex-1 h-7 px-2 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.08] disabled:opacity-35 text-[11px] font-medium text-zinc-200 flex items-center justify-center gap-1 transition-colors cursor-pointer"
            title={t('sub.batchExportTitle')}
          >
            <FolderDown className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span className="truncate">{t('sub.batchExportBtn', { n: internalEnabledCount })}</span>
          </button>

          <button
            disabled={!hasMedia || totalEnabled === 0 || isBusy}
            onClick={onDeleteCheckedSubtitles}
            className="h-7 px-2 rounded-lg bg-rose-500/10 hover:bg-rose-500/25 border border-rose-500/25 hover:border-rose-500/45 disabled:opacity-35 text-[11px] font-medium text-rose-300 flex items-center justify-center gap-1 transition-colors cursor-pointer shrink-0"
            title={t('sub.batchDeleteTitle')}
          >
            <Trash2 className="w-3.5 h-3.5 shrink-0" />
            <span>{t('sub.batchDeleteBtn', { n: totalEnabled })}</span>
          </button>
        </div>

        {/* Batch Subtitle Offset Toolbar (applies to all checked subtitles in 1 click) */}
        {subtitles.length > 0 && (
          <div className="p-2 rounded-lg bg-sky-500/[0.06] border border-sky-500/20 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <div
                className="flex items-center gap-1.5 text-[10px] font-medium text-sky-200"
                title={t('sub.batchOffsetTitle')}
              >
                <Clock className="w-3 h-3 text-sky-400 shrink-0" />
                <span>{t('sub.batchOffsetLabel', { n: totalEnabled })}</span>
              </div>
              {anyCheckedHasDelay && (
                <button
                  type="button"
                  disabled={totalEnabled === 0 || isBusy}
                  onClick={() => {
                    setBatchDelayText('0');
                    onBatchSetSubtitlesDelay(0);
                  }}
                  className="h-5 px-1.5 rounded bg-white/[0.07] hover:bg-rose-500/20 text-[10px] text-zinc-300 hover:text-rose-200 flex items-center gap-1 cursor-pointer disabled:opacity-35"
                  title={t('sub.batchOffsetResetTitle')}
                >
                  <RotateCcw className="w-2.5 h-2.5" />
                  <span>{t('sub.batchOffsetReset')}</span>
                </button>
              )}
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={totalEnabled === 0 || isBusy}
                onClick={() => onBatchShiftSubtitles(-0.5)}
                className="h-6 px-1.5 rounded bg-white/[0.07] hover:bg-white/[0.15] disabled:opacity-35 text-[10px] font-mono-num text-zinc-200 cursor-pointer"
                title={t('sub.offsetEarlier', { s: '0.5' })}
              >
                -0.5
              </button>
              <button
                type="button"
                disabled={totalEnabled === 0 || isBusy}
                onClick={() => onBatchShiftSubtitles(-0.1)}
                className="h-6 px-1.5 rounded bg-white/[0.07] hover:bg-white/[0.15] disabled:opacity-35 text-[10px] font-mono-num text-zinc-200 cursor-pointer"
                title={t('sub.offsetEarlier', { s: '0.1' })}
              >
                -0.1
              </button>
              <button
                type="button"
                disabled={totalEnabled === 0 || isBusy}
                onClick={() => onBatchShiftSubtitles(0.1)}
                className="h-6 px-1.5 rounded bg-white/[0.07] hover:bg-white/[0.15] disabled:opacity-35 text-[10px] font-mono-num text-zinc-200 cursor-pointer"
                title={t('sub.offsetLater', { s: '0.1' })}
              >
                +0.1
              </button>
              <button
                type="button"
                disabled={totalEnabled === 0 || isBusy}
                onClick={() => onBatchShiftSubtitles(0.5)}
                className="h-6 px-1.5 rounded bg-white/[0.07] hover:bg-white/[0.15] disabled:opacity-35 text-[10px] font-mono-num text-zinc-200 cursor-pointer"
                title={t('sub.offsetLater', { s: '0.5' })}
              >
                +0.5
              </button>

              <div className="flex-1 flex items-center gap-1 ml-1">
                <input
                  type="number"
                  step="0.1"
                  value={batchDelayText}
                  onChange={(e) => setBatchDelayText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      applyBatchInput();
                    }
                  }}
                  disabled={totalEnabled === 0 || isBusy}
                  className="w-full min-w-[46px] h-6 px-1.5 rounded bg-black/50 border border-white/[0.1] focus:border-sky-400/60 text-[11px] font-mono-num text-center text-sky-200 outline-none disabled:opacity-35"
                  title={t('sub.offsetInputTitle')}
                />
                <button
                  type="button"
                  disabled={totalEnabled === 0 || isBusy}
                  onClick={applyBatchInput}
                  className="h-6 px-2 rounded bg-sky-500/25 hover:bg-sky-500/40 border border-sky-400/40 disabled:opacity-35 text-[10px] font-semibold text-sky-100 cursor-pointer shrink-0 transition-colors"
                  title={t('sub.batchOffsetApplyTitle')}
                >
                  {t('sub.batchOffsetApply')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Subtitle list */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {subtitles.length === 0 ? (
          <div className="py-10 text-center space-y-2">
            <Subtitles className="w-7 h-7 text-zinc-700 mx-auto" />
            <div className="text-xs text-zinc-400">
              {hasMedia ? t('sub.emptyHasMedia') : t('sub.emptyNoMedia')}
            </div>
          </div>
        ) : (
          subtitles.map((sub, idx) => {
            const isPreviewing = activePreviewSid === sub.mpv_sid;
            const isExternal = sub.source_kind === 'external';

            return (
              <div
                key={sub.id}
                className={`p-2.5 rounded-xl border transition-colors ${
                  sub.enabled
                    ? isExternal
                      ? 'bg-sky-500/[0.07] border-sky-500/30'
                      : 'bg-white/[0.04] border-white/[0.1]'
                    : 'bg-black/25 border-white/[0.04] opacity-55'
                }`}
              >
                <div className="flex items-center justify-between gap-1.5 mb-2">
                  <label className="flex items-center gap-2 cursor-pointer min-w-0">
                    <input
                      type="checkbox"
                      checked={sub.enabled}
                      onChange={(e) => onUpdateSubtitle(sub.id, { enabled: e.target.checked })}
                      className="w-3.5 h-3.5 accent-emerald-400 rounded cursor-pointer"
                    />
                    <span className="text-[11px] font-mono-num font-semibold text-sky-300 shrink-0">
                      {t('sub.itemLabel', { n: idx + 1 })}
                    </span>
                    <span className="px-1.5 py-0.5 rounded bg-white/[0.07] text-[10px] font-mono-num uppercase text-zinc-200 shrink-0">
                      {sub.codec_name}
                    </span>
                    {isExternal && (
                      <span className="px-1.5 py-0.5 rounded bg-sky-500/20 text-[9px] font-medium text-sky-200 shrink-0">
                        {t('sub.externalBadge')}
                      </span>
                    )}
                  </label>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => onPreviewSubtitle(isPreviewing ? 0 : sub.mpv_sid)}
                      className={`h-6 px-2 rounded-md text-[10px] font-medium flex items-center gap-1 transition-colors cursor-pointer ${
                        isPreviewing
                          ? 'bg-sky-500 text-slate-950 font-semibold'
                          : 'bg-white/[0.06] hover:bg-white/[0.12] text-zinc-300'
                      }`}
                      title={isPreviewing ? t('sub.previewHideTitle') : t('sub.previewShowTitle')}
                    >
                      <Eye className="w-3 h-3" />
                      <span>{isPreviewing ? t('sub.previewing') : t('sub.preview')}</span>
                    </button>

                    {!isExternal && (
                      <button
                        disabled={isBusy}
                        onClick={() => onExportSingleSubtitle(sub)}
                        className="p-1 rounded hover:bg-emerald-500/20 text-zinc-400 hover:text-emerald-300 disabled:opacity-35 cursor-pointer"
                        title={t('sub.exportSingleTitle')}
                      >
                        <Download className="w-3.5 h-3.5" />
                      </button>
                    )}

                    <button
                      onClick={() => onSetDefaultSubtitle(sub.id)}
                      className={`p-1 rounded hover:bg-white/[0.08] cursor-pointer ${
                        sub.is_default ? 'text-amber-400' : 'text-zinc-600 hover:text-zinc-300'
                      }`}
                      title={t('sub.setDefaultTitle')}
                    >
                      <Star className={`w-3.5 h-3.5 ${sub.is_default ? 'fill-amber-400' : ''}`} />
                    </button>

                    <button
                      disabled={isBusy}
                      onClick={() => onDeleteSubtitle(sub.id)}
                      className="p-1 rounded hover:bg-rose-500/20 text-zinc-500 hover:text-rose-400 disabled:opacity-35 cursor-pointer"
                      title={t('sub.deleteSubTitle')}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Editable subtitle track name + language */}
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={sub.title}
                    onChange={(e) => onUpdateSubtitle(sub.id, { title: e.target.value })}
                    placeholder={t('sub.namePlaceholder')}
                    className="flex-1 h-7 px-2 rounded-md bg-black/45 border border-white/[0.08] focus:border-sky-400/60 text-[11px] text-zinc-100 placeholder:text-zinc-600 outline-none"
                  />
                  <input
                    type="text"
                    value={sub.language}
                    onChange={(e) => onUpdateSubtitle(sub.id, { language: e.target.value })}
                    placeholder={t('sub.langPlaceholder')}
                    title={t('sub.langTitle')}
                    className="w-12 h-7 px-1.5 rounded-md bg-black/45 border border-white/[0.08] focus:border-sky-400/60 text-[10px] font-mono-num text-center text-zinc-300 placeholder:text-zinc-600 outline-none"
                  />
                </div>

                {/* Subtitle Time Offset Adjustment (both internal & external: live preview + lossless export) */}
                <div className="mt-2 pt-2 border-t border-white/[0.06] flex items-center justify-between gap-1.5">
                  <div
                    className="flex items-center gap-1 text-[10px] text-zinc-400 shrink-0"
                    title={t('sub.offsetTitle')}
                  >
                    <Clock className="w-3 h-3 text-sky-400" />
                    <span>{t('sub.offsetLabel')}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() =>
                        onSetSubtitleDelay(sub.id, Math.round((sub.delay_sec - 0.5) * 100) / 100)
                      }
                      className="h-6 px-1.5 rounded bg-white/[0.06] hover:bg-white/[0.13] text-[10px] font-mono-num text-zinc-300 cursor-pointer"
                      title={t('sub.offsetEarlier', { s: '0.5' })}
                    >
                      -0.5
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        onSetSubtitleDelay(sub.id, Math.round((sub.delay_sec - 0.1) * 100) / 100)
                      }
                      className="h-6 px-1.5 rounded bg-white/[0.06] hover:bg-white/[0.13] text-[10px] font-mono-num text-zinc-300 cursor-pointer"
                      title={t('sub.offsetEarlier', { s: '0.1' })}
                    >
                      -0.1
                    </button>
                    <input
                      type="number"
                      step="0.1"
                      value={Number.isFinite(sub.delay_sec) ? sub.delay_sec : 0}
                      onChange={(e) => {
                        const v = parseFloat(e.target.value);
                        onSetSubtitleDelay(sub.id, Number.isFinite(v) ? v : 0);
                      }}
                      className="w-[52px] h-6 px-1 rounded bg-black/50 border border-white/[0.1] focus:border-sky-400/60 text-[11px] font-mono-num text-center text-sky-200 outline-none"
                      title={t('sub.offsetInputTitle')}
                    />
                    <button
                      type="button"
                      onClick={() =>
                        onSetSubtitleDelay(sub.id, Math.round((sub.delay_sec + 0.1) * 100) / 100)
                      }
                      className="h-6 px-1.5 rounded bg-white/[0.06] hover:bg-white/[0.13] text-[10px] font-mono-num text-zinc-300 cursor-pointer"
                      title={t('sub.offsetLater', { s: '0.1' })}
                    >
                      +0.1
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        onSetSubtitleDelay(sub.id, Math.round((sub.delay_sec + 0.5) * 100) / 100)
                      }
                      className="h-6 px-1.5 rounded bg-white/[0.06] hover:bg-white/[0.13] text-[10px] font-mono-num text-zinc-300 cursor-pointer"
                      title={t('sub.offsetLater', { s: '0.5' })}
                    >
                      +0.5
                    </button>
                    {Math.abs(sub.delay_sec) > 0.001 && totalEnabled > 1 && (
                      <button
                        type="button"
                        onClick={() => {
                          setBatchDelayText(String(sub.delay_sec));
                          onBatchSetSubtitlesDelay(sub.delay_sec);
                        }}
                        className="h-6 w-6 rounded bg-sky-500/20 hover:bg-sky-500/35 text-sky-300 flex items-center justify-center cursor-pointer"
                        title={t('sub.applyToAllCheckedTitle', { s: String(sub.delay_sec) })}
                      >
                        <CopyCheck className="w-3 h-3" />
                      </button>
                    )}
                    {Math.abs(sub.delay_sec) > 0.001 && (
                      <button
                        type="button"
                        onClick={() => onSetSubtitleDelay(sub.id, 0)}
                        className="h-6 w-6 rounded bg-white/[0.06] hover:bg-rose-500/20 text-zinc-400 hover:text-rose-300 flex items-center justify-center cursor-pointer"
                        title={t('sub.offsetResetTitle')}
                      >
                        <RotateCcw className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
