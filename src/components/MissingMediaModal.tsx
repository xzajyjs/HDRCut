import React from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Film,
  FolderSearch,
  Subtitles,
  Volume2,
  X,
} from 'lucide-react';
import type { MissingMediaItem } from '../types/media';
import { useI18n } from '../i18n';

interface MissingMediaModalProps {
  open: boolean;
  projectName: string;
  items: MissingMediaItem[];
  onLocateItem: (key: string) => void;
  onToggleSkipItem: (key: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}

export const MissingMediaModal: React.FC<MissingMediaModalProps> = ({
  open,
  projectName,
  items,
  onLocateItem,
  onToggleSkipItem,
  onCancel,
  onConfirm,
}) => {
  const { t } = useI18n();

  if (!open) return null;

  const relinkedCount = items.filter((i) => Boolean(i.relinkedPath)).length;

  const kindLabel = (kind: MissingMediaItem['kind']) => {
    if (kind === 'video') return t('relink.kindVideo');
    if (kind === 'audio') return t('relink.kindAudio');
    return t('relink.kindSubtitle');
  };

  const KindIcon = ({ kind }: { kind: MissingMediaItem['kind'] }) => {
    if (kind === 'video') return <Film className="w-3.5 h-3.5 text-amber-400 shrink-0" />;
    if (kind === 'audio') return <Volume2 className="w-3.5 h-3.5 text-cyan-400 shrink-0" />;
    return <Subtitles className="w-3.5 h-3.5 text-sky-400 shrink-0" />;
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-6 select-none"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-[680px] max-h-[82vh] bg-[#0e121b] border border-amber-500/30 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-white/[0.08] flex items-center justify-between bg-[#141824]">
          <div className="flex items-center gap-2.5 min-w-0">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            <div className="min-w-0">
              <div className="text-sm font-semibold text-white truncate">{t('relink.title')}</div>
              <div className="text-[11px] text-zinc-400 truncate">{projectName}</div>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="h-7 w-7 rounded-lg bg-white/[0.06] hover:bg-white/[0.14] text-zinc-300 flex items-center justify-center cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Subtitle hint */}
        <div className="px-5 pt-3.5 pb-2 text-[11px] text-zinc-300 leading-relaxed">
          {t('relink.subtitle', { n: items.length })}
        </div>

        {/* Missing Files List */}
        <div className="flex-1 overflow-y-auto px-5 py-2 space-y-2.5">
          {items.map((item) => {
            const isRelinked = Boolean(item.relinkedPath);
            return (
              <div
                key={item.key}
                className={`p-3 rounded-xl border transition-colors space-y-2 ${
                  isRelinked
                    ? 'bg-emerald-500/[0.07] border-emerald-500/35'
                    : item.skipped
                    ? 'bg-black/30 border-white/[0.06] opacity-60'
                    : 'bg-amber-500/[0.05] border-amber-500/30'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <KindIcon kind={item.kind} />
                    <span className="px-1.5 py-0.5 rounded bg-white/[0.08] text-[10px] font-medium text-zinc-200 shrink-0">
                      {t('relink.tabBadge', { n: item.tabIndex + 1 })}
                    </span>
                    <span className="px-1.5 py-0.5 rounded bg-white/[0.06] text-[10px] text-zinc-300 shrink-0">
                      {kindLabel(item.kind)}
                    </span>
                    <span className="text-xs font-medium text-white truncate" title={item.fileName}>
                      {item.fileName}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {isRelinked ? (
                      <span className="text-[10px] font-semibold text-emerald-300 flex items-center gap-1 mr-1">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        {t('relink.statusRelinked')}
                      </span>
                    ) : item.skipped ? (
                      <span className="text-[10px] text-zinc-400 mr-1">
                        {t('relink.statusSkipped')}
                      </span>
                    ) : (
                      <span className="text-[10px] font-medium text-amber-300 mr-1">
                        {t('relink.statusMissing')}
                      </span>
                    )}

                    <button
                      type="button"
                      onClick={() => onLocateItem(item.key)}
                      className="h-7 px-2.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
                    >
                      <FolderSearch className="w-3.5 h-3.5" />
                      <span>{isRelinked ? t('relink.relocateBtn') : t('relink.locateBtn')}</span>
                    </button>

                    {!isRelinked && (
                      <button
                        type="button"
                        onClick={() => onToggleSkipItem(item.key)}
                        className="h-7 px-2 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.08] text-[10px] text-zinc-300 cursor-pointer"
                      >
                        {item.skipped ? t('relink.unskipBtn') : t('relink.skipBtn')}
                      </button>
                    )}
                  </div>
                </div>

                <div className="text-[10px] font-mono-num space-y-0.5 pl-5">
                  <div className="text-zinc-500 truncate" title={item.originalPath}>
                    {t('relink.originalPath')}: {item.originalPath}
                  </div>
                  {item.relinkedPath && (
                    <div className="text-emerald-300 truncate" title={item.relinkedPath}>
                      {t('relink.newPath')}: {item.relinkedPath}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-white/[0.08] bg-[#10141f] flex items-center justify-between gap-3">
          <span className="text-[11px] text-zinc-400">
            {t('relink.summary', { relinked: relinkedCount, total: items.length })}
          </span>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onCancel}
              className="h-8 px-3 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-xs text-zinc-300 cursor-pointer"
            >
              {t('relink.cancel')}
            </button>
            <button
              type="button"
              onClick={onConfirm}
              className="h-8 px-4 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-semibold cursor-pointer"
            >
              {t('relink.confirm')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
