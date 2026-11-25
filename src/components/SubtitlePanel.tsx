import React from 'react';
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
} from 'lucide-react';
import type { EditableSubtitleTrack } from '../types/media';

interface SubtitlePanelProps {
  hasMedia: boolean;
  subtitles: EditableSubtitleTrack[];
  activePreviewSid: number;
  isBusy: boolean;
  onPreviewSubtitle: (mpvSid: number) => void;
  onUpdateSubtitle: (id: string, patch: Partial<EditableSubtitleTrack>) => void;
  onSetSubtitleDelay: (id: string, delaySec: number) => void;
  onSetDefaultSubtitle: (id: string) => void;
  onRemoveExternalSubtitle: (id: string) => void;
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
  onSetSubtitleDelay,
  onSetDefaultSubtitle,
  onRemoveExternalSubtitle,
  onImportSubtitle,
  onExportSingleSubtitle,
  onExportBatchSubtitles,
}) => {
  const internalEnabledCount = subtitles.filter(
    (s) => s.enabled && s.source_kind === 'internal'
  ).length;
  const totalEnabled = subtitles.filter((s) => s.enabled).length;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header actions */}
      <div className="p-3 border-b border-white/[0.06] space-y-2 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs font-semibold text-zinc-100">
            字幕管理 ({totalEnabled}/{subtitles.length})
          </div>
          {activePreviewSid > 0 && hasMedia && (
            <button
              onClick={() => onPreviewSubtitle(0)}
              className="h-6 px-2 rounded-md bg-white/[0.06] hover:bg-white/[0.12] text-[10px] text-zinc-300 flex items-center gap-1 cursor-pointer"
              title="隐藏预览画面中的字幕"
            >
              <EyeOff className="w-3 h-3 text-zinc-400" />
              <span>关闭字幕预览</span>
            </button>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <button
            disabled={!hasMedia || isBusy}
            onClick={onImportSubtitle}
            className="flex-1 h-7 px-2.5 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-400/35 disabled:opacity-40 text-[11px] font-medium text-cyan-200 flex items-center justify-center gap-1 transition-colors cursor-pointer"
          >
            <FilePlus2 className="w-3.5 h-3.5" />
            <span>导入字幕</span>
          </button>

          <button
            disabled={!hasMedia || internalEnabledCount === 0 || isBusy}
            onClick={onExportBatchSubtitles}
            className="flex-1 h-7 px-2.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.08] disabled:opacity-35 text-[11px] font-medium text-zinc-200 flex items-center justify-center gap-1 transition-colors cursor-pointer"
            title="将勾选的内封字幕批量提取导出到指定文件夹"
          >
            <FolderDown className="w-3.5 h-3.5 text-emerald-400" />
            <span>批量导出 ({internalEnabledCount})</span>
          </button>
        </div>
      </div>

      {/* Subtitle list */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {subtitles.length === 0 ? (
          <div className="py-10 text-center space-y-2">
            <Subtitles className="w-7 h-7 text-zinc-700 mx-auto" />
            <div className="text-xs text-zinc-400">
              {hasMedia ? '当前视频未包含内封字幕，可点击上方「导入字幕」' : '导入视频后将自动分析内封字幕'}
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
                      字幕 #{idx + 1}
                    </span>
                    <span className="px-1.5 py-0.5 rounded bg-white/[0.07] text-[10px] font-mono-num uppercase text-zinc-200 shrink-0">
                      {sub.codec_name}
                    </span>
                    {isExternal && (
                      <span className="px-1.5 py-0.5 rounded bg-sky-500/20 text-[9px] font-medium text-sky-200 shrink-0">
                        外挂
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
                      title={isPreviewing ? '点击隐藏字幕预览' : '在视频画面中实时预览该字幕'}
                    >
                      <Eye className="w-3 h-3" />
                      <span>{isPreviewing ? '预览中' : '预览'}</span>
                    </button>

                    {!isExternal && (
                      <button
                        disabled={isBusy}
                        onClick={() => onExportSingleSubtitle(sub)}
                        className="p-1 rounded hover:bg-emerald-500/20 text-zinc-400 hover:text-emerald-300 disabled:opacity-35 cursor-pointer"
                        title="单独导出此条字幕"
                      >
                        <Download className="w-3.5 h-3.5" />
                      </button>
                    )}

                    <button
                      onClick={() => onSetDefaultSubtitle(sub.id)}
                      className={`p-1 rounded hover:bg-white/[0.08] cursor-pointer ${
                        sub.is_default ? 'text-amber-400' : 'text-zinc-600 hover:text-zinc-300'
                      }`}
                      title="设为默认字幕轨"
                    >
                      <Star className={`w-3.5 h-3.5 ${sub.is_default ? 'fill-amber-400' : ''}`} />
                    </button>

                    {isExternal && (
                      <button
                        onClick={() => onRemoveExternalSubtitle(sub.id)}
                        className="p-1 rounded hover:bg-rose-500/20 text-zinc-500 hover:text-rose-400 cursor-pointer"
                        title="移除此外挂字幕"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Editable Chinese subtitle track name + language */}
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={sub.title}
                    onChange={(e) => onUpdateSubtitle(sub.id, { title: e.target.value })}
                    placeholder="字幕名称（支持中文，如：简体中文 / 双语特效）"
                    className="flex-1 h-7 px-2 rounded-md bg-black/45 border border-white/[0.08] focus:border-sky-400/60 text-[11px] text-zinc-100 placeholder:text-zinc-600 outline-none"
                  />
                  <input
                    type="text"
                    value={sub.language}
                    onChange={(e) => onUpdateSubtitle(sub.id, { language: e.target.value })}
                    placeholder="语言"
                    title="ISO 639-2 语言代码 (如 chi / eng / jpn)"
                    className="w-12 h-7 px-1.5 rounded-md bg-black/45 border border-white/[0.08] focus:border-sky-400/60 text-[10px] font-mono-num text-center text-zinc-300 placeholder:text-zinc-600 outline-none"
                  />
                </div>

                {/* Subtitle Time Offset Adjustment (for imported external subtitles: live preview + export!) */}
                {isExternal && (
                  <div className="mt-2 pt-2 border-t border-white/[0.06] flex items-center justify-between gap-1.5">
                    <div
                      className="flex items-center gap-1 text-[10px] text-zinc-400 shrink-0"
                      title="正数(+)表示延后出现，负数(-)表示提前出现；预览与导出均生效"
                    >
                      <Clock className="w-3 h-3 text-sky-400" />
                      <span>偏移(秒)</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() =>
                          onSetSubtitleDelay(sub.id, Math.round((sub.delay_sec - 0.5) * 100) / 100)
                        }
                        className="h-6 px-1.5 rounded bg-white/[0.06] hover:bg-white/[0.13] text-[10px] font-mono-num text-zinc-300 cursor-pointer"
                        title="提前 0.5 秒"
                      >
                        -0.5
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          onSetSubtitleDelay(sub.id, Math.round((sub.delay_sec - 0.1) * 100) / 100)
                        }
                        className="h-6 px-1.5 rounded bg-white/[0.06] hover:bg-white/[0.13] text-[10px] font-mono-num text-zinc-300 cursor-pointer"
                        title="提前 0.1 秒"
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
                        className="w-[54px] h-6 px-1 rounded bg-black/50 border border-white/[0.1] focus:border-sky-400/60 text-[11px] font-mono-num text-center text-sky-200 outline-none"
                        title="手动输入偏移秒数 (+ 延后 / - 提前)"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          onSetSubtitleDelay(sub.id, Math.round((sub.delay_sec + 0.1) * 100) / 100)
                        }
                        className="h-6 px-1.5 rounded bg-white/[0.06] hover:bg-white/[0.13] text-[10px] font-mono-num text-zinc-300 cursor-pointer"
                        title="延后 0.1 秒"
                      >
                        +0.1
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          onSetSubtitleDelay(sub.id, Math.round((sub.delay_sec + 0.5) * 100) / 100)
                        }
                        className="h-6 px-1.5 rounded bg-white/[0.06] hover:bg-white/[0.13] text-[10px] font-mono-num text-zinc-300 cursor-pointer"
                        title="延后 0.5 秒"
                      >
                        +0.5
                      </button>
                      {Math.abs(sub.delay_sec) > 0.001 && (
                        <button
                          type="button"
                          onClick={() => onSetSubtitleDelay(sub.id, 0)}
                          className="h-6 w-6 rounded bg-white/[0.06] hover:bg-rose-500/20 text-zinc-400 hover:text-rose-300 flex items-center justify-center cursor-pointer"
                          title="重置偏移为 0 秒"
                        >
                          <RotateCcw className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
