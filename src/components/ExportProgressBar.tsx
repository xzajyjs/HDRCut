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
      className={`pointer-events-auto w-full rounded-2xl border backdrop-blur-md shadow-2xl shadow-black/60 p-3.5 text-xs transition-all ${
        isDone
          ? 'bg-[#0b261c]/95 border-emerald-500/45'
          : isError
          ? 'bg-[#281018]/95 border-rose-500/45'
          : isRunning
          ? 'bg-[#0f1726]/95 border-cyan-500/40'
          : 'bg-[#141824]/95 border-white/[0.14]'
      }`}
    >
      {/* Header Row: Status Icon + Message + Top-Right Close */}
      <div className="flex items-start gap-2.5">
        <div className="pt-0.5 shrink-0">
          {isRunning && <Loader2 className="w-4 h-4 animate-spin text-cyan-400" />}
          {isDone && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
          {isError && <AlertTriangle className="w-4 h-4 text-rose-400" />}
          {progress.status === 'cancelled' && <XCircle className="w-4 h-4 text-zinc-400" />}
        </div>

        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-start justify-between gap-2">
            <div
              className={`font-medium leading-snug break-words ${
                isDone
                  ? 'text-emerald-50'
                  : isError
                  ? 'text-rose-100'
                  : 'text-zinc-100'
              }`}
              title={progress.message}
            >
              {progress.message}
            </div>
            {!isRunning && (
              <button
                type="button"
                onClick={onDismiss}
                className="w-5 h-5 -mt-0.5 -mr-1 rounded-md hover:bg-white/[0.1] text-zinc-400 hover:text-zinc-100 flex items-center justify-center shrink-0 cursor-pointer transition-colors"
                title={t('export.close')}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {showMeta && (
            <div className="font-mono-num text-[11px] text-zinc-300/80 flex items-center flex-wrap gap-x-1.5 gap-y-0.5">
              {hasTiming && (
                <span>
                  {formatTimecode(progress.out_time_sec)} / {formatTimecode(progress.expected_duration_sec)}
                </span>
              )}
              {hasTiming && hasBytes && <span className="text-zinc-500">·</span>}
              {hasBytes && <span>{formatBytes(progress.written_bytes)}</span>}
              {(hasTiming || hasBytes) && hasSpeed && <span className="text-zinc-500">·</span>}
              {hasSpeed && <span className="text-cyan-300/90">{progress.speed}</span>}
            </div>
          )}
        </div>
      </div>

      {/* Progress Bar when running */}
      {isRunning && (
        <div className="mt-2.5 flex items-center gap-2.5 pl-6">
          <div className="flex-1 h-1.5 rounded-full bg-white/[0.1] overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-cyan-400 to-emerald-400 transition-all duration-200"
              style={{ width: `${Math.max(2, Math.min(100, progress.percent))}%` }}
            />
          </div>
          <span className="font-mono-num text-[11px] font-semibold text-cyan-300 w-9 text-right shrink-0">
            {progress.percent.toFixed(0)}%
          </span>
        </div>
      )}

      {/* Action Buttons Row */}
      {(isDone || (isRunning && canCancel) || isError || progress.status === 'cancelled') && (
        <div className="mt-3 pl-6 flex items-center justify-end gap-2">
          {isRunning && canCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="h-7 px-3 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 text-[11px] text-rose-200 font-medium cursor-pointer transition-colors"
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
              className="h-7 px-2.5 rounded-lg bg-white/[0.08] hover:bg-white/[0.14] text-[11px] text-zinc-200 cursor-pointer transition-colors"
            >
              {t('export.close')}
            </button>
          )}
        </div>
      )}
    </div>
  );
};
