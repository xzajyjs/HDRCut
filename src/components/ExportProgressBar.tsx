import React from 'react';
import { CheckCircle2, FolderOpen, XCircle, Loader2, AlertTriangle } from 'lucide-react';
import type { ExportProgressEvent } from '../types/media';
import { formatBytes, formatTimecode } from '../utils/timecode';

interface ExportProgressBarProps {
  progress: ExportProgressEvent | null;
  onCancel: () => void;
  onRevealOutput: (path: string) => void;
  onDismiss: () => void;
}

export const ExportProgressBar: React.FC<ExportProgressBarProps> = ({
  progress,
  onCancel,
  onRevealOutput,
  onDismiss,
}) => {
  if (!progress) return null;

  const isRunning = progress.status === 'running';
  const isDone = progress.status === 'done';
  const isError = progress.status === 'error';

  return (
    <div
      className={`h-[44px] shrink-0 px-4 border-t flex items-center justify-between gap-4 text-xs ${
        isDone
          ? 'bg-emerald-950/50 border-emerald-500/30'
          : isError
          ? 'bg-rose-950/50 border-rose-500/30'
          : 'bg-[#101624] border-cyan-500/30'
      }`}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        {isRunning && <Loader2 className="w-4 h-4 animate-spin text-cyan-400 shrink-0" />}
        {isDone && <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />}
        {isError && <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />}
        {progress.status === 'cancelled' && <XCircle className="w-4 h-4 text-zinc-400 shrink-0" />}

        <span className="font-medium text-zinc-100 truncate" title={progress.message}>
          {progress.message}
        </span>

        {(isRunning || isDone) && (
          <span className="font-mono-num text-[11px] text-zinc-400 shrink-0">
            {formatTimecode(progress.out_time_sec)} / {formatTimecode(progress.expected_duration_sec)} ·{' '}
            {formatBytes(progress.written_bytes)}
          </span>
        )}
      </div>

      {isRunning && (
        <div className="flex-1 max-w-sm flex items-center gap-2.5">
          <div className="flex-1 h-2 rounded-full bg-white/[0.08] overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-cyan-400 to-emerald-400 transition-all duration-200"
              style={{ width: `${Math.max(2, Math.min(100, progress.percent))}%` }}
            />
          </div>
          <span className="font-mono-num text-[11px] text-cyan-300 w-10 text-right">
            {progress.percent.toFixed(0)}%
          </span>
        </div>
      )}

      <div className="flex items-center gap-2 shrink-0">
        {isRunning && (
          <button
            onClick={onCancel}
            className="h-7 px-3 rounded-md bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 text-[11px] text-rose-200 font-medium cursor-pointer"
          >
            取消导出
          </button>
        )}
        {isDone && (
          <button
            onClick={() => onRevealOutput(progress.output_path)}
            className="h-7 px-3 rounded-md bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-[11px] font-semibold flex items-center gap-1.5 cursor-pointer"
          >
            <FolderOpen className="w-3.5 h-3.5" />
            <span>打开所在文件夹</span>
          </button>
        )}
        {!isRunning && (
          <button
            onClick={onDismiss}
            className="h-7 px-2.5 rounded-md bg-white/[0.06] hover:bg-white/[0.12] text-[11px] text-zinc-300 cursor-pointer"
          >
            关闭
          </button>
        )}
      </div>
    </div>
  );
};
