import React from 'react';
import { Film, Plus, X } from 'lucide-react';
import type { TabSession } from '../types/media';
import { useI18n } from '../i18n';

interface TabBarProps {
  tabs: TabSession[];
  activeTabId: string;
  disabled?: boolean;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onNewTab: () => void;
}

export const TabBar: React.FC<TabBarProps> = ({
  tabs,
  activeTabId,
  disabled,
  onSelectTab,
  onCloseTab,
  onNewTab,
}) => {
  const { t } = useI18n();

  return (
    <div className="h-[34px] shrink-0 bg-[#080a0f] border-b border-white/[0.07] px-2 flex items-center gap-1 overflow-x-auto select-none">
      <div className="flex items-center gap-1 min-w-0">
        {tabs.map((tab, idx) => {
          const isActive = tab.id === activeTabId;
          const label = tab.media ? tab.media.file_name : t('tab.newTabLabel', { n: idx + 1 });
          const hasEdits =
            tab.ranges.length > 0 ||
            tab.mixedTracks.length > 0 ||
            tab.audioTracks.some((a) => a.source_kind === 'external') ||
            tab.subtitleTracks.some((s) => s.source_kind === 'external');

          const shortcutHint =
            idx < 8
              ? t('tab.shortcutSwitch', { n: idx + 1 })
              : idx === 8
              ? t('tab.shortcutSwitch', { n: 9 })
              : '';

          return (
            <div
              key={tab.id}
              onClick={() => {
                if (!disabled && !isActive) onSelectTab(tab.id);
              }}
              title={
                tab.media
                  ? t('tab.mediaTabTitle', { path: tab.media.file_path, shortcut: shortcutHint })
                  : t('tab.newTabTitle', { shortcut: shortcutHint })
              }
              className={`group h-[26px] pl-2.5 pr-1.5 rounded-t-lg border-t border-l border-r flex items-center gap-1.5 max-w-[220px] min-w-[110px] transition-colors cursor-pointer shrink-0 ${
                isActive
                  ? 'bg-[#0d1017] border-white/[0.12] text-zinc-100'
                  : 'bg-white/[0.02] hover:bg-white/[0.05] border-transparent text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Film
                className={`w-3 h-3 shrink-0 ${
                  tab.media
                    ? isActive
                      ? 'text-cyan-400'
                      : 'text-zinc-500'
                    : 'text-zinc-600'
                }`}
              />
              <span className="text-[11px] font-medium truncate flex-1">{label}</span>
              {hasEdits && (
                <span
                  className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0"
                  title={t('tab.hasEdits')}
                />
              )}
              <button
                type="button"
                disabled={disabled}
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseTab(tab.id);
                }}
                className={`w-4 h-4 rounded flex items-center justify-center shrink-0 transition-colors cursor-pointer ${
                  isActive
                    ? 'text-zinc-400 hover:bg-white/[0.12] hover:text-white'
                    : 'text-zinc-500 opacity-60 group-hover:opacity-100 hover:bg-white/[0.12] hover:text-white'
                }`}
                title={t('tab.closeTitle')}
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        disabled={disabled}
        onClick={onNewTab}
        className="h-[24px] w-[24px] rounded-md hover:bg-white/[0.09] text-zinc-400 hover:text-zinc-100 flex items-center justify-center shrink-0 transition-colors cursor-pointer disabled:opacity-35"
        title={t('tab.addTitle')}
      >
        <Plus className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};
