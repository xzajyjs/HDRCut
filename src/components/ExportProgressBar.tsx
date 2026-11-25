import React from 'react';
import { CheckCircle2, FolderOpen, XCircle, Loader2, AlertTriangle } from 'lucide-react';
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

function formatEta(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '--';
  if (seconds < 1) return '<1s';
  if (seconds < 60) return `${Math.ceil(seconds)}s`;
  const totalSec = Math.ceil(seconds);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

function formatElapsed(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '';
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

function formatWriteRate(bps: number): string {
  if (!Number.isFinite(bps) || bps <= 0) return '';
  if (bps >= 1024 ** 3) return `${(bps / 1024 ** 3).toFixed(2)} GB/s`;
  if (bps >= 1024 ** 2) {
    const mb = bps / 1024 ** 2;
    return `${mb >= 100 ? mb.toFixed(0) : mb.toFixed(1)} MB/s`;
  }
  if (bps >= 1024) return `${(bps / 1024).toFixed(0)} KB/s`;
  return `${Math.round(bps)} B/s`;
}

function getFileName(p: string): string {
  if (!p) return '';
  const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return idx >= 0 ? p.slice(idx + 1) : p;
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
  const cleanSpeed =
    progress.speed && progress.speed.trim() && progress.speed.trim() !== '0x'
      ? progress.speed.trim()
      : '';
  const etaText =
    isRunning && typeof progress.eta_sec === 'number' && Number.isFinite(progress.eta_sec)
      ? t('export.eta', { t: formatEta(progress.eta_sec) })
      : '';
  const writeRateText =
    typeof progress.write_bytes_per_sec === 'number' && progress.write_bytes_per_sec > 0
      ? formatWriteRate(progress.write_bytes_per_sec)
      : '';
  const elapsedText =
    isDone && typeof progress.elapsed_sec === 'number' && progress.elapsed_sec > 0.05
      ? t('export.elapsed', { t: formatElapsed(progress.elapsed_sec) })
      : '';

  const runningMetaParts: string[] = [];
  if (etaText) runningMetaParts.push(etaText);
  if (writeRateText) runningMetaParts.push(writeRateText);
  if (cleanSpeed) runningMetaParts.push(cleanSpeed);
  if (hasBytes) runningMetaParts.push(formatBytes(progress.written_bytes));

  const doneMetaParts: string[] = [];
  if (hasTiming) {
    doneMetaParts.push(
      `${formatTimecode(progress.out_time_sec)} / ${formatTimecode(progress.expected_duration_sec)}`
    );
  }
  if (hasBytes) doneMetaParts.push(formatBytes(progress.written_bytes));
  if (elapsedText) doneMetaParts.push(elapsedText);
  if (writeRateText) doneMetaParts.push(writeRateText);

  const outputFileName = getFileName(progress.output_path);
  const showFileNameLine =
    isDone && Boolean(outputFileName) && !progress.message.includes(outputFileName);

  return (
    <div
      className={`pointer-events-auto w-[540px] max-w-[calc(100vw-24px)] max-h-[80px] rounded-2xl border backdrop-blur-md shadow-2xl shadow-black/75 px-3.5 py-2 text-xs flex items-center gap-3 transition-all ${
        isDone
          ? 'bg-[#0b2a1e]/95 border-emerald-400/55 ring-1 ring-emerald-400/20'
          : isError
          ? 'bg-[#2a1018]/95 border-rose-500/55 ring-1 ring-rose-500/20'
          : isRunning
          ? 'bg-[#0f1828]/95 border-cyan-400/50 ring-1 ring-cyan-400/20'
          : 'bg-[#151a26]/95 border-white/[0.16]'
      }`}
    >
      {/* Left Multi-Line Information Column (keeps total card height <= 78px, strictly above native video view) */}
      <div className="flex-1 min-w-0">
        {isRunning ? (
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2 min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-400 shrink-0" />
                <span className="font-medium text-zinc-100 truncate" title={progress.message}>
                  {progress.message}
                </span>
              </div>
              <span className="font-mono-num text-[11px] font-semibold text-cyan-300 shrink-0">
                {progress.percent.toFixed(0)}%
              </span>
            </div>

            <div className="h-1.5 rounded-full bg-white/[0.1] overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-cyan-400 to-emerald-400 transition-all duration-200"
                style={{ width: `${Math.max(2, Math.min(100, progress.percent))}%` }}
              />
            </div>

            {runningMetaParts.length > 0 && (
              <div className="font-mono-num text-[10.5px] text-cyan-200/90 leading-tight truncate">
                {runningMetaParts.join(' · ')}
              </div>
            )}
          </div>
        ) : isDone ? (
          <div className="space-y-0.5">
            <div className="flex items-center gap-1.5 min-w-0">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span
                className="font-semibold text-emerald-50 leading-tight truncate"
                title={progress.message}
              >
                {progress.message}
              </span>
            </div>

            {doneMetaParts.length > 0 && (
              <div className="font-mono-num text-[10.5px] text-emerald-200/90 leading-snug break-words">
                {doneMetaParts.join(' · ')}
              </div>
            )}

            {showFileNameLine && (
              <div
                className="text-[10px] text-emerald-300/70 leading-tight truncate"
                title={progress.output_path}
              >
                {outputFileName}
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-start gap-2 min-w-0">
            {isError ? (
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            ) : (
              <XCircle className="w-4 h-4 text-zinc-400 shrink-0 mt-0.5" />
            )}
            <div
              className={`text-[11px] leading-snug line-clamp-3 break-words ${
                isError ? 'text-rose-100' : 'text-zinc-200'
              }`}
              title={progress.message}
            >
              {progress.message}
            </div>
          </div>
        )}
      </div>

      {/* Right Action Buttons Column */}
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
  );
};
