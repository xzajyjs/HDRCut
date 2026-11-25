import React from 'react';
import { Film, Globe, Check } from 'lucide-react';
import { useI18n, type Locale } from '../i18n';

interface LanguageModalProps {
  open: boolean;
  allowClose?: boolean;
  onClose?: () => void;
}

export const LanguageModal: React.FC<LanguageModalProps> = ({ open, allowClose, onClose }) => {
  const { locale, setLocale, t } = useI18n();

  if (!open) return null;

  const choose = (next: Locale) => {
    setLocale(next);
    onClose?.();
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-6 select-none"
      onClick={() => {
        if (allowClose) onClose?.();
      }}
    >
      <div
        className="w-full max-w-[460px] bg-[#0e121b] border border-white/[0.12] rounded-2xl shadow-2xl p-6 space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex flex-col items-center text-center space-y-2.5">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-cyan-400 via-sky-500 to-amber-400 flex items-center justify-center shadow-lg shadow-cyan-500/20">
            <Film className="w-6 h-6 text-slate-950 stroke-[2.3]" />
          </div>
          <div className="space-y-1">
            <h2 className="text-base font-bold text-white tracking-tight flex items-center justify-center gap-2">
              <Globe className="w-4 h-4 text-cyan-400" />
              <span>{t('langModal.title')}</span>
            </h2>
            <p className="text-[11px] text-zinc-400 leading-relaxed">{t('langModal.subtitle')}</p>
          </div>
        </div>

        {/* Two crisp language cards */}
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => choose('en')}
            className={`group p-4 rounded-xl border text-left transition-colors cursor-pointer flex flex-col justify-between gap-3 ${
              allowClose && locale === 'en'
                ? 'bg-cyan-500/15 border-cyan-400/60'
                : 'bg-white/[0.03] hover:bg-cyan-500/10 border-white/[0.1] hover:border-cyan-400/50'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="px-2 py-0.5 rounded-md bg-cyan-500/15 text-[10px] font-mono-num font-bold text-cyan-300">
                EN
              </span>
              {allowClose && locale === 'en' && <Check className="w-4 h-4 text-cyan-300" />}
            </div>
            <div>
              <div className="text-sm font-semibold text-white">English</div>
              <div className="text-[11px] text-zinc-400 mt-0.5">Lossless HDR Editor</div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => choose('zh')}
            className={`group p-4 rounded-xl border text-left transition-colors cursor-pointer flex flex-col justify-between gap-3 ${
              allowClose && locale === 'zh'
                ? 'bg-cyan-500/15 border-cyan-400/60'
                : 'bg-white/[0.03] hover:bg-cyan-500/10 border-white/[0.1] hover:border-cyan-400/50'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="px-2 py-0.5 rounded-md bg-amber-500/15 text-[10px] font-semibold text-amber-300">
                中文
              </span>
              {allowClose && locale === 'zh' && <Check className="w-4 h-4 text-cyan-300" />}
            </div>
            <div>
              <div className="text-sm font-semibold text-white">简体中文</div>
              <div className="text-[11px] text-zinc-400 mt-0.5">无损 HDR 视频剪辑</div>
            </div>
          </button>
        </div>

        <p className="text-center text-[10px] text-zinc-500">{t('langModal.hint')}</p>
      </div>
    </div>
  );
};
