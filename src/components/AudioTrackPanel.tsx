import React, { useState } from 'react';
import {
  Headphones,
  Plus,
  Trash2,
  Star,
  ArrowUp,
  ArrowDown,
  Layers,
  Volume2,
  Check,
  X,
  Download,
  FolderDown,
  FilePlus2,
} from 'lucide-react';
import type { EditableAudioTrack, MixedAudioTrackConfig } from '../types/media';
import { formatBitrate } from '../utils/timecode';
import { useI18n } from '../i18n';

interface AudioTrackPanelProps {
  hasMedia: boolean;
  tracks: EditableAudioTrack[];
  mixedTracks: MixedAudioTrackConfig[];
  activePreviewAid: number;
  isBusy: boolean;
  onPreviewTrack: (mpvAid: number) => void;
  onUpdateTrack: (id: string, patch: Partial<EditableAudioTrack>) => void;
  onMoveTrack: (index: number, direction: -1 | 1) => void;
  onRemoveExternalTrack: (id: string) => void;
  onSetDefaultTrack: (kind: 'original' | 'mixed', id: string) => void;
  onImportAudioTrack: () => void;
  onExportSingleAudio: (track: EditableAudioTrack) => void;
  onExportBatchAudio: () => void;
  onAddMixedTrack: (mix: MixedAudioTrackConfig) => void;
  onUpdateMixedTrack: (id: string, patch: Partial<MixedAudioTrackConfig>) => void;
  onDeleteMixedTrack: (id: string) => void;
}

export const AudioTrackPanel: React.FC<AudioTrackPanelProps> = ({
  hasMedia,
  tracks,
  mixedTracks,
  activePreviewAid,
  isBusy,
  onPreviewTrack,
  onUpdateTrack,
  onMoveTrack,
  onRemoveExternalTrack,
  onSetDefaultTrack,
  onImportAudioTrack,
  onExportSingleAudio,
  onExportBatchAudio,
  onAddMixedTrack,
  onUpdateMixedTrack,
  onDeleteMixedTrack,
}) => {
  const { t } = useI18n();
  const [creatingMix, setCreatingMix] = useState(false);
  const [selectedSources, setSelectedSources] = useState<number[]>([]);
  const [gainsDb, setGainsDb] = useState<Record<number, number>>({});
  const [mixTitle, setMixTitle] = useState('');
  const [mixCodec, setMixCodec] = useState<'flac' | 'pcm_s24le' | 'aac'>('flac');
  const [mixNormalize, setMixNormalize] = useState(false);

  const internalTracks = tracks.filter((tr) => tr.source_kind === 'internal');
  const enabledInternalCount = internalTracks.filter((tr) => tr.enabled).length;

  const openMixBuilder = () => {
    const defaults = internalTracks.slice(0, 2).map((tr) => tr.audio_index);
    setSelectedSources(defaults);
    const initialGains: Record<number, number> = {};
    defaults.forEach((idx) => {
      initialGains[idx] = 0;
    });
    setGainsDb(initialGains);
    setMixTitle(
      defaults.length >= 2
        ? `${internalTracks[0]?.title || `${t('audio.defaultTrackPrefix')}1`}+${internalTracks[1]?.title || `${t('audio.defaultTrackPrefix')}2`}`
        : t('audio.defaultMixName')
    );
    setMixCodec('flac');
    setMixNormalize(false);
    setCreatingMix(true);
  };

  const toggleSourceInMix = (audioIndex: number) => {
    setSelectedSources((prev) =>
      prev.includes(audioIndex) ? prev.filter((x) => x !== audioIndex) : [...prev, audioIndex]
    );
  };

  const handleCreateMix = () => {
    if (selectedSources.length < 2) return;
    onAddMixedTrack({
      id: `mix_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      source_audio_indices: [...selectedSources],
      gains_db: { ...gainsDb },
      title: mixTitle.trim() || t('audio.defaultMixName'),
      codec: mixCodec,
      normalize: mixNormalize,
      enabled: true,
      is_default: false,
    });
    setCreatingMix(false);
  };

  const enabledOriginalCount = tracks.filter((tr) => tr.enabled).length;
  const enabledMixedCount = mixedTracks.filter((m) => m.enabled).length;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header actions */}
      <div className="p-3 border-b border-white/[0.06] space-y-2 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs font-semibold text-zinc-100">
            {t('audio.header', { orig: enabledOriginalCount, mix: enabledMixedCount })}
          </div>
          {internalTracks.length >= 2 && (
            <button
              onClick={openMixBuilder}
              className="h-6 px-2 rounded-md bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-400/35 text-[10px] font-medium text-cyan-300 flex items-center gap-1 transition-colors cursor-pointer shrink-0"
            >
              <Plus className="w-3 h-3" />
              <span>{t('audio.mixBtn')}</span>
            </button>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <button
            disabled={!hasMedia || isBusy}
            onClick={onImportAudioTrack}
            className="flex-1 h-7 px-2.5 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-400/35 disabled:opacity-40 text-[11px] font-medium text-cyan-200 flex items-center justify-center gap-1 transition-colors cursor-pointer"
            title={t('audio.importTitle')}
          >
            <FilePlus2 className="w-3.5 h-3.5" />
            <span>{t('audio.importBtn')}</span>
          </button>

          <button
            disabled={!hasMedia || enabledInternalCount === 0 || isBusy}
            onClick={onExportBatchAudio}
            className="flex-1 h-7 px-2.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.08] disabled:opacity-35 text-[11px] font-medium text-zinc-200 flex items-center justify-center gap-1 transition-colors cursor-pointer"
            title={t('audio.batchExportTitle')}
          >
            <FolderDown className="w-3.5 h-3.5 text-emerald-400" />
            <span>{t('audio.batchExportBtn', { n: enabledInternalCount })}</span>
          </button>
        </div>
      </div>

      {/* Scrollable track list + mix builder */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
        {tracks.length === 0 ? (
          <div className="py-10 text-center space-y-2">
            <Volume2 className="w-7 h-7 text-zinc-700 mx-auto" />
            <div className="text-xs text-zinc-400">
              {hasMedia ? t('audio.emptyHasMedia') : t('audio.emptyNoMedia')}
            </div>
          </div>
        ) : (
          <>
            {/* Original & Imported Audio Tracks */}
            <div className="space-y-2">
              {tracks.map((track, idx) => {
                const isPreviewing = activePreviewAid === track.mpv_aid;
                const isExternal = track.source_kind === 'external';
                return (
                  <div
                    key={track.id}
                    className={`p-2.5 rounded-xl border transition-colors ${
                      track.enabled
                        ? isExternal
                          ? 'bg-emerald-500/[0.07] border-emerald-500/30'
                          : 'bg-white/[0.04] border-white/[0.1]'
                        : 'bg-black/25 border-white/[0.04] opacity-55'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1.5 mb-2">
                      <label className="flex items-center gap-1.5 cursor-pointer min-w-0">
                        <input
                          type="checkbox"
                          checked={track.enabled}
                          onChange={(e) => onUpdateTrack(track.id, { enabled: e.target.checked })}
                          className="w-3.5 h-3.5 accent-emerald-400 rounded cursor-pointer"
                        />
                        <span className="text-[11px] font-mono-num font-semibold text-cyan-300 shrink-0">
                          #{idx + 1}
                        </span>
                        <span className="px-1.5 py-0.5 rounded bg-white/[0.07] text-[10px] font-mono-num uppercase text-zinc-200 shrink-0">
                          {track.codec_name}
                        </span>
                        {isExternal && (
                          <span className="px-1 py-0.5 rounded bg-emerald-500/20 text-[9px] font-medium text-emerald-200 shrink-0">
                            {t('audio.externalBadge')}
                          </span>
                        )}
                        <span className="text-[10px] text-zinc-400 truncate">
                          {track.channel_layout} · {(track.sample_rate / 1000).toFixed(1)}kHz
                          {track.bit_rate ? ` · ${formatBitrate(track.bit_rate)}` : ''}
                        </span>
                      </label>

                      <div className="flex items-center gap-0.5 shrink-0">
                        <button
                          onClick={() => onPreviewTrack(track.mpv_aid)}
                          className={`h-6 px-2 rounded-md text-[10px] font-medium flex items-center gap-1 transition-colors cursor-pointer ${
                            isPreviewing
                              ? 'bg-cyan-500 text-slate-950 font-semibold'
                              : 'bg-white/[0.06] hover:bg-white/[0.12] text-zinc-300'
                          }`}
                          title={t('audio.auditionTitle')}
                        >
                          <Headphones className="w-3 h-3" />
                          <span>{isPreviewing ? t('audio.auditioning') : t('audio.audition')}</span>
                        </button>

                        {!isExternal && (
                          <button
                            disabled={isBusy}
                            onClick={() => onExportSingleAudio(track)}
                            className="p-1 rounded hover:bg-emerald-500/20 text-zinc-400 hover:text-emerald-300 disabled:opacity-35 cursor-pointer"
                            title={t('audio.exportSingleTitle')}
                          >
                            <Download className="w-3.5 h-3.5" />
                          </button>
                        )}

                        <button
                          onClick={() => onSetDefaultTrack('original', track.id)}
                          className={`p-1 rounded hover:bg-white/[0.08] cursor-pointer ${
                            track.is_default ? 'text-amber-400' : 'text-zinc-600 hover:text-zinc-300'
                          }`}
                          title={t('audio.setDefaultTitle')}
                        >
                          <Star className={`w-3.5 h-3.5 ${track.is_default ? 'fill-amber-400' : ''}`} />
                        </button>

                        {isExternal ? (
                          <button
                            onClick={() => onRemoveExternalTrack(track.id)}
                            className="p-1 rounded hover:bg-rose-500/20 text-zinc-500 hover:text-rose-400 cursor-pointer"
                            title={t('audio.removeExternalTitle')}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        ) : (
                          <>
                            <button
                              disabled={idx === 0}
                              onClick={() => onMoveTrack(idx, -1)}
                              className="p-1 rounded hover:bg-white/[0.08] text-zinc-500 hover:text-zinc-200 disabled:opacity-25 cursor-pointer"
                              title={t('audio.moveUpTitle')}
                            >
                              <ArrowUp className="w-3 h-3" />
                            </button>
                            <button
                              disabled={idx === tracks.length - 1}
                              onClick={() => onMoveTrack(idx, 1)}
                              className="p-1 rounded hover:bg-white/[0.08] text-zinc-500 hover:text-zinc-200 disabled:opacity-25 cursor-pointer"
                              title={t('audio.moveDownTitle')}
                            >
                              <ArrowDown className="w-3 h-3" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Editable Track Name + Language */}
                    <div className="flex items-center gap-1.5">
                      <input
                        type="text"
                        value={track.title}
                        onChange={(e) => onUpdateTrack(track.id, { title: e.target.value })}
                        placeholder={t('audio.namePlaceholder')}
                        className="flex-1 h-7 px-2 rounded-md bg-black/45 border border-white/[0.08] focus:border-cyan-400/60 text-[11px] text-zinc-100 placeholder:text-zinc-600 outline-none"
                      />
                      <input
                        type="text"
                        value={track.language}
                        onChange={(e) => onUpdateTrack(track.id, { language: e.target.value })}
                        placeholder={t('audio.langPlaceholder')}
                        title={t('audio.langTitle')}
                        className="w-12 h-7 px-1.5 rounded-md bg-black/45 border border-white/[0.08] focus:border-cyan-400/60 text-[10px] font-mono-num text-center text-zinc-300 placeholder:text-zinc-600 outline-none"
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Inline Mixed Track Builder */}
            {creatingMix && (
              <div className="p-3 rounded-xl bg-[#131926] border border-cyan-500/40 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-cyan-300 flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5" />
                    {t('audio.newMixTitle')}
                  </span>
                  <button
                    onClick={() => setCreatingMix(false)}
                    className="text-zinc-500 hover:text-zinc-200 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="space-y-1.5">
                  <div className="text-[10px] text-zinc-400">{t('audio.selectSourcesHint')}</div>
                  {internalTracks.map((tr) => {
                    const checked = selectedSources.includes(tr.audio_index);
                    const gain = gainsDb[tr.audio_index] ?? 0;
                    return (
                      <div
                        key={tr.id}
                        className={`px-2 py-1.5 rounded-lg border flex items-center justify-between gap-2 ${
                          checked
                            ? 'bg-cyan-500/10 border-cyan-500/35'
                            : 'bg-black/30 border-white/[0.06]'
                        }`}
                      >
                        <label className="flex items-center gap-2 text-[11px] text-zinc-200 cursor-pointer min-w-0">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleSourceInMix(tr.audio_index)}
                            className="accent-cyan-400"
                          />
                          <span className="truncate">
                            #{tr.audio_index + 1} {tr.title || tr.codec_name}
                          </span>
                        </label>

                        {checked && (
                          <div className="flex items-center gap-1.5 shrink-0">
                            <input
                              type="range"
                              min={-12}
                              max={12}
                              step={1}
                              value={gain}
                              onChange={(e) =>
                                setGainsDb((prev) => ({
                                  ...prev,
                                  [tr.audio_index]: Number(e.target.value),
                                }))
                              }
                              className="w-16 accent-cyan-400 cursor-pointer"
                            />
                            <span className="text-[10px] font-mono-num text-cyan-300 w-10 text-right">
                              {gain > 0 ? `+${gain}` : gain}dB
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div className="space-y-1.5">
                  <input
                    type="text"
                    value={mixTitle}
                    onChange={(e) => setMixTitle(e.target.value)}
                    placeholder={t('audio.mixNamePlaceholder')}
                    className="w-full h-7 px-2 rounded-md bg-black/50 border border-white/[0.1] focus:border-cyan-400/60 text-[11px] text-zinc-100 outline-none"
                  />
                  <div className="flex items-center justify-between gap-2">
                    <select
                      value={mixCodec}
                      onChange={(e) => setMixCodec(e.target.value as 'flac' | 'pcm_s24le' | 'aac')}
                      className="h-7 px-2 rounded-md bg-black/50 border border-white/[0.1] text-[11px] text-zinc-200 outline-none cursor-pointer"
                    >
                      <option value="flac">{t('audio.codecFlac')}</option>
                      <option value="pcm_s24le">{t('audio.codecPcm')}</option>
                      <option value="aac">{t('audio.codecAac')}</option>
                    </select>

                    <label className="flex items-center gap-1 text-[10px] text-zinc-400 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={mixNormalize}
                        onChange={(e) => setMixNormalize(e.target.checked)}
                        className="accent-cyan-400"
                      />
                      <span>{t('audio.normalize')}</span>
                    </label>
                  </div>
                </div>

                <div className="flex justify-end gap-1.5 pt-1">
                  <button
                    onClick={() => setCreatingMix(false)}
                    className="h-7 px-2.5 rounded-lg bg-white/[0.06] text-[11px] text-zinc-300 cursor-pointer"
                  >
                    {t('audio.cancel')}
                  </button>
                  <button
                    disabled={selectedSources.length < 2}
                    onClick={handleCreateMix}
                    className="h-7 px-3 rounded-lg bg-cyan-500 hover:bg-cyan-400 disabled:opacity-35 text-slate-950 text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>{t('audio.addMixBtn')}</span>
                  </button>
                </div>
              </div>
            )}

            {/* Existing Mixed Tracks */}
            {mixedTracks.length > 0 && (
              <div className="pt-1 space-y-2">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-cyan-400/90 flex items-center gap-1">
                  <Layers className="w-3 h-3" />
                  <span>{t('audio.pendingMixHeader', { n: mixedTracks.length })}</span>
                </div>

                {mixedTracks.map((mix) => (
                  <div
                    key={mix.id}
                    className={`p-2.5 rounded-xl border space-y-2 ${
                      mix.enabled
                        ? 'bg-cyan-500/[0.08] border-cyan-500/30'
                        : 'bg-black/25 border-white/[0.04] opacity-55'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={mix.enabled}
                          onChange={(e) =>
                            onUpdateMixedTrack(mix.id, { enabled: e.target.checked })
                          }
                          className="accent-cyan-400"
                        />
                        <span className="text-[11px] font-semibold text-cyan-200">
                          {t('audio.mixLabel', {
                            tracks: mix.source_audio_indices.map((i) => `#${i + 1}`).join(' + '),
                          })}
                        </span>
                        <span className="px-1.5 py-0.5 rounded bg-cyan-500/20 text-[9px] font-mono-num uppercase text-cyan-200">
                          {mix.codec === 'flac'
                            ? t('audio.flacBadge')
                            : mix.codec === 'pcm_s24le'
                            ? 'PCM/ALAC'
                            : 'AAC 320k'}
                        </span>
                      </label>

                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => onSetDefaultTrack('mixed', mix.id)}
                          className={`p-1 rounded hover:bg-white/[0.08] cursor-pointer ${
                            mix.is_default ? 'text-amber-400' : 'text-zinc-600 hover:text-zinc-300'
                          }`}
                          title={t('audio.setDefaultTitle')}
                        >
                          <Star className={`w-3.5 h-3.5 ${mix.is_default ? 'fill-amber-400' : ''}`} />
                        </button>
                        <button
                          onClick={() => onDeleteMixedTrack(mix.id)}
                          className="p-1 rounded hover:bg-rose-500/20 text-zinc-500 hover:text-rose-400 cursor-pointer"
                          title={t('audio.removeMixTitle')}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <input
                      type="text"
                      value={mix.title}
                      onChange={(e) => onUpdateMixedTrack(mix.id, { title: e.target.value })}
                      placeholder={t('audio.mixTitleInputPlaceholder')}
                      className="w-full h-7 px-2 rounded-md bg-black/45 border border-white/[0.08] focus:border-cyan-400/60 text-[11px] text-zinc-100 outline-none"
                    />
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
