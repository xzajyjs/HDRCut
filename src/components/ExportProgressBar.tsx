import React from 'react';
import { CheckCircle2, FolderOpen, XCircle, Loader2, AlertTriangle, X } from 'lucide-react';
import type { ExportProgressEvent } from '../types/media';
import { formatBytes, formatTimecode } from '../utils/timecode';
import { useI18n } from '../i18n';

interface ExportProgressBarProps {
  progress: ExportProgressEvent | null;
  canCancel?: boolean;
  onCancel: () => void;
  onRevealOutput: (path: string) => void;
  onDismiss: () => void;
}

export const ExportProgressBar: React.FC<ExportProgressBarProps> = ({
  progress,
  canCancel = true,
  onCancel,
  onRevealOutput,
  onDismiss,
}) => {
  const { t } = useI18n();
  if (!progress) return null;

  const isRunning = progress.status === 'running';
  const isDone = progress.status === 'done';
  const isError = progress.status === 'error';

  const hasTiming = progress.expected_duration_sec > 0;
  const hasBytes = progress.written_bytes > 0;
  const hasSpeed = Boolean(progress.speed && progress.speed.trim());
  const showMeta = (isRunning || isDone) && (hasTiming || hasBytes || hasSpeed);

  return (
    <div
      className={`pointer-events-auto w-[420px] max-w-[calc(100vw-24px)] max-h-[78px] rounded-2xl border backdrop-blur-md shadow-2xl shadow-black/75 px-3.5 py-2.5 text-xs transition-all ${
        isDone
          ? 'bg-[#0b2a1e]/95 border-emerald-400/55 ring-1 ring-emerald-400/20'
          : isError
          ? 'bg-[#2a1018]/95 border-rose-500/55 ring-1 ring-rose-500/20'
          : isRunning
          ? 'bg-[#0f1828]/95 border-cyan-400/50 ring-1 ring-cyan-400/20'
          : 'bg-[#151a26]/95 border-white/[0.16]'
      }`}
    >
      {/* Row 1: Icon + Single-line Message + Compact Close (stays strictly inside top 88px chrome above native video) */}
      <div className="flex items-center gap-2 min-w-0 h-5">
        {isRunning && <Loader2 className="w-4 h-4 animate-spin text-cyan-400 shrink-0" />}
        {isDone && <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />}
        {isError && <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />}
        {progress.status === 'cancelled' && <XCircle className="w-4 h-4 text-zinc-400 shrink-0" />}

        <span
          className={`flex-1 font-medium truncate ${
            isDone ? 'text-emerald-50' : isError ? 'text-rose-100' : 'text-zinc-100'
          }`}
          title={progress.message}
        >
          {progress.message}
        </span>

        {!isRunning && (
          <button
            type="button"
            onClick={onDismiss}
            className="w-5 h-5 -mr-1 rounded-md hover:bg-white/[0.12] text-zinc-300 hover:text-white flex items-center justify-center shrink-0 cursor-pointer transition-colors"
            title={t('export.close')}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Row 2: Progress / Meta on Left + Action Buttons on Right */}
      <div className="mt-2 flex items-center justify-between gap-2.5 h-7">
        <div className="flex-1 min-w-0 flex items-center gap-2">
          {isRunning ? (
            <>
              <div className="flex-1 h-1.5 rounded-full bg-white/[0.1] overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-cyan-400 to-emerald-400 transition-all duration-200"
                  style={{ width: `${Math.max(2, Math.min(100, progress.percent))}%` }}
                />
              </div>
              <span className="font-mono-num text-[11px] font-semibold text-cyan-300 shrink-0">
                {progress.percent.toFixed(0)}%
              </span>
            </>
          ) : showMeta ? (
            <span className="font-mono-num text-[11px] text-emerald-200/80 truncate">
              {hasTiming &&
                `${formatTimecode(progress.out_time_sec)} / ${formatTimecode(progress.expected_duration_sec)}`}
              {hasTiming && hasBytes ? ' · ' : ''}
              {hasBytes ? formatBytes(progress.written_bytes) : ''}
              {(hasTiming || hasBytes) && hasSpeed ? ' · ' : ''}
              {hasSpeed ? progress.speed : ''}
            </span>
          ) : (
            <span />
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {isRunning && canCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="h-7 px-2.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 text-[11px] text-rose-200 font-medium cursor-pointer transition-colors"
            >
              {t('export.cancel')}
            </button>
          )}
          {isDone && progress.output_path && (
            <button
              type="button"
              onClick={() => onRevealOutput(progress.output_path)}
              className="h-7 px-3 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-[11px] font-semibold flex items-center gap-1.5 cursor-pointer transition-colors"
            >
              <FolderOpen className="w-3.5 h-3.5" />
              <span>{t('export.reveal')}</span>
            </button>
          )}
          {!isRunning && (
            <button
              type="button"
              onClick={onDismiss}
              className="h-7 px-2.5 rounded-lg bg-white/[0.09] hover:bg-white/[0.16] text-[11px] text-zinc-200 cursor-pointer transition-colors"
            >
              {t('export.close')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
