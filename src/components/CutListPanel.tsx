import React, { useMemo, useState } from 'react';
import {
  Scissors,
  Trash2,
  ClipboardPaste,
  Play,
  Plus,
  Check,
  AlertCircle,
  Sparkles,
  X,
} from 'lucide-react';
import type { CutMode, CutRange, ExportSegment } from '../types/media';
import { formatTimecode, parseBatchTimeRanges, parseTimeToken } from '../utils/timecode';
import { snapToNearestKeyframe } from '../utils/segments';

interface CutListPanelProps {
  duration: number;
  currentTime: number;
  keyframes: number[];
  cutMode: CutMode;
  ranges: CutRange[];
  keptSegments: ExportSegment[];
  snapKeyframes: boolean;
  onCutModeChange: (mode: CutMode) => void;
  onAddRange: (start: number, end: number) => void;
  onAddBatchRanges: (items: Array<{ start: number; end: number }>, replace: boolean) => void;
  onUpdateRange: (id: string, start: number, end: number) => void;
  onDeleteRange: (id: string) => void;
  onClearRanges: () => void;
  onSeek: (seconds: number, exact: boolean) => void;
}

export const CutListPanel: React.FC<CutListPanelProps> = ({
  duration,
  currentTime,
  keyframes,
  cutMode,
  ranges,
  keptSegments,
  snapKeyframes,
  onCutModeChange,
  onAddRange,
  onAddBatchRanges,
  onUpdateRange,
  onDeleteRange,
  onClearRanges,
  onSeek,
}) => {
  const [showBatch, setShowBatch] = useState(false);
  const [batchText, setBatchText] = useState('');
  const [replaceExisting, setReplaceExisting] = useState(false);
  const [manualStart, setManualStart] = useState('');
  const [manualEnd, setManualEnd] = useState('');
  const [manualError, setManualError] = useState<string | null>(null);

  const parsedBatch = useMemo(
    () => parseBatchTimeRanges(batchText, duration),
    [batchText, duration]
  );

  const totalKeptDuration = useMemo(
    () => keptSegments.reduce((acc, s) => acc + Math.max(0, s.end - s.start), 0),
    [keptSegments]
  );

  const handleApplyBatch = () => {
    if (parsedBatch.ranges.length === 0) return;
    const processed = parsedBatch.ranges.map((r) => {
      if (!snapKeyframes || keyframes.length === 0) {
        return { start: r.start, end: r.end };
      }
      const s = r.start <= 0.05 ? 0 : snapToNearestKeyframe(r.start, keyframes, duration, 'nearest');
      const e =
        r.end >= duration - 0.05
          ? duration
          : snapToNearestKeyframe(r.end, keyframes, duration, 'nearest');
      return { start: s, end: Math.max(s + 0.1, e) };
    });
    onAddBatchRanges(processed, replaceExisting);
    setBatchText('');
    setShowBatch(false);
  };

  const handleManualAdd = () => {
    setManualError(null);
    const s = parseTimeToken(manualStart, duration);
    const e = parseTimeToken(manualEnd, duration);
    if (s === null || e === null) {
      setManualError('时间格式无效，示例: 00:01:25 或 末尾');
      return;
    }
    if (e <= s) {
      setManualError('结束时间必须大于开始时间');
      return;
    }
    const finalS = snapKeyframes && keyframes.length > 0 ? snapToNearestKeyframe(s, keyframes, duration) : s;
    const finalE = snapKeyframes && keyframes.length > 0 ? snapToNearestKeyframe(e, keyframes, duration) : e;
    onAddRange(finalS, Math.max(finalS + 0.1, finalE));
    setManualStart('');
    setManualEnd('');
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Mode Switcher: Remove vs Keep */}
      <div className="p-3 border-b border-white/[0.06] space-y-2.5 shrink-0">
        <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-black/40 border border-white/[0.06]">
          <button
            onClick={() => onCutModeChange('remove')}
            className={`h-8 rounded-lg text-[11px] font-semibold transition cursor-pointer ${
              cutMode === 'remove'
                ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40 shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            剔除选中区间 (默认)
          </button>
          <button
            onClick={() => onCutModeChange('keep')}
            className={`h-8 rounded-lg text-[11px] font-semibold transition cursor-pointer ${
              cutMode === 'keep'
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            仅保留选中区间
          </button>
        </div>

        <div className="flex items-center justify-between gap-2">
          <button
            disabled={duration <= 0}
            onClick={() => setShowBatch((v) => !v)}
            className={`flex-1 h-8 px-2.5 rounded-lg border text-[11px] font-medium flex items-center justify-center gap-1.5 transition cursor-pointer disabled:opacity-40 ${
              showBatch
                ? 'bg-cyan-500/20 border-cyan-400/50 text-cyan-200'
                : 'bg-white/[0.05] hover:bg-white/[0.09] border-white/[0.08] text-zinc-200'
            }`}
          >
            <ClipboardPaste className="w-3.5 h-3.5 text-cyan-400" />
            <span>批量导入时间段</span>
          </button>

          {ranges.length > 0 && (
            <button
              onClick={onClearRanges}
              className="h-8 px-2.5 rounded-lg bg-white/[0.04] hover:bg-rose-500/20 border border-white/[0.07] hover:border-rose-500/30 text-[11px] text-zinc-400 hover:text-rose-300 transition cursor-pointer"
              title="清空所有区间"
            >
              清空
            </button>
          )}
        </div>

        {/* Inline Batch Time Range Importer */}
        {showBatch && (
          <div className="p-2.5 rounded-xl bg-[#131824] border border-cyan-500/30 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-cyan-300">
                粘贴批量时间段 (支持「和」、换行、逗号、末尾)
              </span>
              <button
                onClick={() => setShowBatch(false)}
                className="text-zinc-500 hover:text-zinc-200 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <textarea
              rows={3}
              value={batchText}
              onChange={(e) => setBatchText(e.target.value)}
              placeholder="例如: 00:01:25-00:02:10 和 00:28:12-00:50:00 和 00:59:32-末尾"
              className="w-full rounded-lg bg-black/50 border border-white/[0.09] focus:border-cyan-400/60 p-2 text-[11px] font-mono-num text-zinc-100 placeholder:text-zinc-600 outline-none resize-none"
            />

            {parsedBatch.ranges.length > 0 && (
              <div className="space-y-1 max-h-24 overflow-y-auto pr-1">
                <div className="text-[10px] text-emerald-400 font-medium">
                  已识别 {parsedBatch.ranges.length} 个有效区间
                  {snapKeyframes && keyframes.length > 0 ? ' (导入时将自动吸附最近关键帧)' : ''}：
                </div>
                {parsedBatch.ranges.map((r, idx) => {
                  const snapS = snapToNearestKeyframe(r.start, keyframes, duration);
                  const snapE = snapToNearestKeyframe(r.end, keyframes, duration);
                  return (
                    <div
                      key={idx}
                      className="text-[10px] font-mono-num text-zinc-300 flex items-center justify-between bg-white/[0.03] px-2 py-0.5 rounded"
                    >
                      <span>
                        #{idx + 1} {formatTimecode(r.start)} → {formatTimecode(r.end)}
                      </span>
                      {snapKeyframes && keyframes.length > 0 && (
                        <span className="text-amber-300/90">
                          I帧 {formatTimecode(snapS)}~{formatTimecode(snapE)}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {parsedBatch.errors.length > 0 && (
              <div className="text-[10px] text-rose-400 flex items-start gap-1">
                <AlertCircle className="w-3 h-3 shrink-0 mt-0.5" />
                <span>{parsedBatch.errors[0]}</span>
              </div>
            )}

            <div className="flex items-center justify-between pt-1">
              <label className="flex items-center gap-1.5 text-[10px] text-zinc-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={replaceExisting}
                  onChange={(e) => setReplaceExisting(e.target.checked)}
                  className="accent-cyan-400"
                />
                <span>覆盖现有区间</span>
              </label>
              <button
                disabled={parsedBatch.ranges.length === 0}
                onClick={handleApplyBatch}
                className="h-7 px-3 rounded-lg bg-cyan-500 hover:bg-cyan-400 disabled:opacity-35 text-slate-950 text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
              >
                <Check className="w-3.5 h-3.5" />
                <span>导入 {parsedBatch.ranges.length} 段</span>
              </button>
            </div>
          </div>
        )}

        {/* Quick manual single range input */}
        <div className="flex items-center gap-1.5">
          <input
            type="text"
            disabled={duration <= 0}
            value={manualStart}
            onChange={(e) => setManualStart(e.target.value)}
            placeholder={formatTimecode(currentTime)}
            className="w-full h-7 px-2 rounded-md bg-black/40 border border-white/[0.08] focus:border-cyan-500/50 text-[11px] font-mono-num text-zinc-200 placeholder:text-zinc-600 outline-none"
          />
          <span className="text-zinc-600 text-xs">-</span>
          <input
            type="text"
            disabled={duration <= 0}
            value={manualEnd}
            onChange={(e) => setManualEnd(e.target.value)}
            placeholder="末尾"
            className="w-full h-7 px-2 rounded-md bg-black/40 border border-white/[0.08] focus:border-cyan-500/50 text-[11px] font-mono-num text-zinc-200 placeholder:text-zinc-600 outline-none"
          />
          <button
            disabled={duration <= 0 || !manualStart || !manualEnd}
            onClick={handleManualAdd}
            className="h-7 px-2 rounded-md bg-white/[0.08] hover:bg-white/[0.14] disabled:opacity-35 text-zinc-100 shrink-0 cursor-pointer"
            title="手动添加区间"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
        {manualError && <div className="text-[10px] text-rose-400">{manualError}</div>}
      </div>

      {/* Scrollable Cut Ranges List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {ranges.length === 0 ? (
          <div className="py-8 text-center space-y-2">
            <Scissors className="w-7 h-7 text-zinc-700 mx-auto" />
            <div className="text-xs text-zinc-400">暂未添加剪辑区间</div>
            <div className="text-[11px] text-zinc-600 leading-relaxed px-4">
              可按 <kbd className="px-1 py-0.5 rounded bg-white/[0.06] text-zinc-400">I</kbd> /{' '}
              <kbd className="px-1 py-0.5 rounded bg-white/[0.06] text-zinc-400">O</kbd> 标记片段，或点击上方「批量导入时间段」。不添加任何区间时将导出完整视频（支持仅修改音轨）。
            </div>
          </div>
        ) : (
          ranges.map((r, index) => {
            const len = Math.max(0, r.end - r.start);
            return (
              <div
                key={r.id}
                className={`p-2.5 rounded-xl border transition ${
                  cutMode === 'remove'
                    ? 'bg-rose-500/[0.06] border-rose-500/25'
                    : 'bg-emerald-500/[0.06] border-emerald-500/25'
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                        cutMode === 'remove'
                          ? 'bg-rose-500/25 text-rose-300'
                          : 'bg-emerald-500/25 text-emerald-300'
                      }`}
                    >
                      {cutMode === 'remove' ? `剪掉 #${index + 1}` : `保留 #${index + 1}`}
                    </span>
                    <span className="text-[10px] font-mono-num text-zinc-400">
                      时长 {formatTimecode(len)}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => onSeek(r.start, true)}
                      className="p-1 rounded hover:bg-white/[0.08] text-zinc-400 hover:text-cyan-300 cursor-pointer"
                      title="跳转到起点预览"
                    >
                      <Play className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => onDeleteRange(r.id)}
                      className="p-1 rounded hover:bg-rose-500/20 text-zinc-500 hover:text-rose-400 cursor-pointer"
                      title="删除此区间"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-1.5 text-[11px] font-mono-num">
                  <button
                    onClick={() => onSeek(r.start, true)}
                    className="text-left px-2 py-1 rounded bg-black/35 hover:bg-black/55 border border-white/[0.06] text-zinc-200 cursor-pointer"
                    title="点击跳转到起点"
                  >
                    <span className="text-[9px] text-zinc-500 block">起点</span>
                    {formatTimecode(r.start, true)}
                  </button>
                  <button
                    onClick={() => onSeek(r.end, true)}
                    className="text-left px-2 py-1 rounded bg-black/35 hover:bg-black/55 border border-white/[0.06] text-zinc-200 cursor-pointer"
                    title="点击跳转到终点"
                  >
                    <span className="text-[9px] text-zinc-500 block">终点</span>
                    {formatTimecode(r.end, true)}
                  </button>
                </div>

                {/* Quick align to current playhead */}
                <div className="flex items-center justify-between mt-1.5 text-[10px]">
                  <button
                    onClick={() => {
                      const s = snapKeyframes
                        ? snapToNearestKeyframe(currentTime, keyframes, duration)
                        : currentTime;
                      if (s < r.end - 0.1) onUpdateRange(r.id, s, r.end);
                    }}
                    className="text-zinc-500 hover:text-cyan-300 cursor-pointer"
                  >
                    设为当前起点
                  </button>
                  <button
                    onClick={() => {
                      const e = snapKeyframes
                        ? snapToNearestKeyframe(currentTime, keyframes, duration)
                        : currentTime;
                      if (e > r.start + 0.1) onUpdateRange(r.id, r.start, e);
                    }}
                    className="text-zinc-500 hover:text-amber-300 cursor-pointer"
                  >
                    设为当前终点
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Footer summary of actual output stitched segments */}
      <div className="p-3 bg-[#0c0f16] border-t border-white/[0.07] shrink-0 space-y-1.5">
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-zinc-400 flex items-center gap-1">
            <Sparkles className="w-3 h-3 text-emerald-400" />
            最终导出拼接 ({keptSegments.length} 段)
          </span>
          <span className="font-mono-num font-semibold text-emerald-300">
            {formatTimecode(totalKeptDuration)}
          </span>
        </div>
        {keptSegments.length > 0 && keptSegments.length <= 6 && (
          <div className="flex flex-wrap gap-1">
            {keptSegments.map((seg, i) => (
              <span
                key={i}
                className="px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-[9px] font-mono-num text-emerald-300/90"
              >
                {formatTimecode(seg.start)}→{formatTimecode(seg.end)}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
