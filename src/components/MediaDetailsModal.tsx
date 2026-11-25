import React, { useState } from 'react';
import { X, Copy, Check, Film, Volume2, Subtitles, FileText } from 'lucide-react';
import type { MediaInfo } from '../types/media';
import { formatBitrate, formatBytes, formatTimecode } from '../utils/timecode';
import { useI18n, type TranslationKey } from '../i18n';

interface MediaDetailsModalProps {
  media: MediaInfo | null;
  open: boolean;
  onClose: () => void;
}

function buildPlainTextReport(
  media: MediaInfo,
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string
): string {
  const lines: string[] = [];
  lines.push(`[${t('details.general')}]`);
  lines.push(`${t('details.fullPath')}: ${media.file_path}`);
  lines.push(`${t('details.container')}: ${media.format_long_name} (${media.format_name})`);
  lines.push(`${t('details.fileSize')}: ${formatBytes(media.file_size)} (${media.file_size.toLocaleString()} Bytes)`);
  lines.push(`${t('details.duration')}: ${formatTimecode(media.duration, true)}`);
  if (media.bit_rate) lines.push(`${t('details.totalBitrate')}: ${formatBitrate(media.bit_rate)}`);
  lines.push(
    `${t('details.streams')}: ${t('details.streamsVal', {
      total: media.nb_streams,
      v: media.video ? 1 : 0,
      a: media.audio_tracks.length,
      s: media.subtitle_tracks.length,
      c: media.nb_chapters,
    })}`
  );
  if (media.encoder_tag) lines.push(`${t('details.muxer')}: ${media.encoder_tag}`);

  if (media.video) {
    const v = media.video;
    lines.push('');
    lines.push(`[${t('details.videoStream', { n: v.stream_index })}]`);
    lines.push(`${t('details.videoCodec')}: ${v.codec_long_name} (${v.codec_name})`);
    if (v.profile) lines.push(`Profile / Level: ${v.profile}${v.level ? ` @ L${(v.level / 10).toFixed(1)}` : ''}`);
    lines.push(`${t('details.resolution')}: ${v.width} × ${v.height}${v.dar ? ` (DAR ${v.dar}` : ''}${v.sar ? `, SAR ${v.sar})` : v.dar ? ')' : ''}`);
    lines.push(`${t('details.fps')}: ${v.fps_display} fps (${v.fps.toFixed(6)})`);
    lines.push(`${t('details.videoBitrate')}: ${formatBitrate(v.bit_rate || media.bit_rate) || t('details.unknown')}`);
    lines.push(`${t('details.bitDepthPixFmt')}: ${v.bit_depth ? `${v.bit_depth}-bit` : t('details.unknown')} / ${v.pix_fmt || t('details.unknown')}`);
    lines.push(`${t('details.dynamicRange')}: ${v.is_hdr ? v.hdr_format || 'HDR' : 'SDR'}`);
    lines.push(
      `${t('details.colorInfo')}: ${t('details.colorInfoVal', {
        p: v.color_primaries || 'N/A',
        t: v.color_transfer || 'N/A',
        m: v.color_space || 'N/A',
        r: v.color_range || 'N/A',
      })}`
    );
    if (v.master_display) lines.push(`${t('details.masterDisplay')}: ${v.master_display}`);
    if (v.max_cll) lines.push(`MaxCLL / MaxFALL: ${v.max_cll}`);
    lines.push(
      `${t('details.scanBFramesKf')}: ${t('details.scanVal', {
        field: v.field_order || 'progressive',
        b: v.has_b_frames ?? 'N/A',
        k: media.keyframes.length,
        tb: v.time_base_den,
      })}`
    );
  }

  media.audio_tracks.forEach((a, i) => {
    lines.push('');
    lines.push(`[${t('details.audioTrackHeader', { n: i + 1, s: a.stream_index })}]`);
    lines.push(`${t('details.codec')}: ${a.codec_long_name} (${a.codec_name})`);
    lines.push(`${t('details.channelsRate')}: ${a.channel_layout} (${a.channels} ${t('details.channelsSuffix')}) · ${(a.sample_rate / 1000).toFixed(1)} kHz`);
    if (a.bit_rate) lines.push(`${t('details.bitrate')}: ${formatBitrate(a.bit_rate)}`);
    lines.push(`${t('details.langTitle')}: ${a.language || t('details.unspecified')} / ${a.title || t('details.untitled')}`);
  });

  media.subtitle_tracks.forEach((s, i) => {
    lines.push('');
    lines.push(`[${t('details.subTrackLabel', { n: i + 1, s: s.stream_index })}]`);
    lines.push(
      t('details.subTrackVal', {
        codec: s.codec_name.toUpperCase(),
        lang: s.language || t('details.unspecified'),
        title: s.title || t('details.untitled'),
      })
    );
  });

  return lines.join('\n');
}

const Row: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="grid grid-cols-[138px_1fr] gap-2 py-1 border-b border-white/[0.04] text-[11px]">
    <span className="text-zinc-500 shrink-0">{label}</span>
    <span className="text-zinc-200 font-mono-num break-all">{value}</span>
  </div>
);

export const MediaDetailsModal: React.FC<MediaDetailsModalProps> = ({ media, open, onClose }) => {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  if (!open || !media) return null;

  const v = media.video;
  const effectiveVideoBitrate = v?.bit_rate || media.bit_rate;

  const handleCopy = () => {
    navigator.clipboard?.writeText(buildPlainTextReport(media, t)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-6"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[740px] max-h-[82vh] bg-[#0e121b] border border-white/[0.12] rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-white/[0.08] flex items-center justify-between bg-[#121723]">
          <div className="flex items-center gap-2.5 min-w-0">
            <FileText className="w-4 h-4 text-cyan-400 shrink-0" />
            <div className="min-w-0">
              <div className="text-sm font-semibold text-white truncate">{t('details.title')}</div>
              <div className="text-[11px] text-zinc-400 truncate">{media.file_name}</div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleCopy}
              className="h-7 px-2.5 rounded-lg bg-white/[0.07] hover:bg-white/[0.13] border border-white/[0.09] text-[11px] text-zinc-200 flex items-center gap-1.5 cursor-pointer"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-emerald-300">{t('details.copied')}</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5 text-zinc-400" />
                  <span>{t('details.copy')}</span>
                </>
              )}
            </button>
            <button
              onClick={onClose}
              className="h-7 w-7 rounded-lg bg-white/[0.06] hover:bg-white/[0.14] text-zinc-300 flex items-center justify-center cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Scrollable PotPlayer-style Sections */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* General */}
          <section className="p-3.5 rounded-xl bg-white/[0.025] border border-white/[0.06]">
            <div className="text-xs font-semibold text-cyan-300 mb-2 flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5" />
              <span>{t('details.general')}</span>
            </div>
            <Row label={t('details.fullPath')} value={media.file_path} />
            <Row label={t('details.container')} value={`${media.format_long_name} (${media.format_name})`} />
            <Row
              label={t('details.fileSize')}
              value={`${formatBytes(media.file_size)} (${media.file_size.toLocaleString()} Bytes)`}
            />
            <Row label={t('details.duration')} value={formatTimecode(media.duration, true)} />
            <Row label={t('details.totalBitrate')} value={formatBitrate(media.bit_rate) || t('details.unknown')} />
            <Row
              label={t('details.streams')}
              value={t('details.streamsVal', {
                total: media.nb_streams,
                v: v ? 1 : 0,
                a: media.audio_tracks.length,
                s: media.subtitle_tracks.length,
                c: media.nb_chapters,
              })}
            />
            {media.encoder_tag && <Row label={t('details.muxer')} value={media.encoder_tag} />}
          </section>

          {/* Video Stream */}
          {v && (
            <section className="p-3.5 rounded-xl bg-white/[0.025] border border-white/[0.06]">
              <div className="text-xs font-semibold text-amber-300 mb-2 flex items-center gap-1.5">
                <Film className="w-3.5 h-3.5" />
                <span>{t('details.videoStream', { n: v.stream_index })}</span>
              </div>
              <Row label={t('details.videoCodec')} value={`${v.codec_long_name} (${v.codec_name.toUpperCase()})`} />
              <Row
                label="Profile / Level"
                value={`${v.profile || 'N/A'}${v.level ? ` @ L${(v.level / 10).toFixed(1)}` : ''}`}
              />
              <Row
                label={t('details.resolution')}
                value={`${v.width} × ${v.height}${v.dar ? ` · DAR ${v.dar}` : ''}${v.sar ? ` · SAR ${v.sar}` : ''}`}
              />
              <Row label={t('details.fps')} value={`${v.fps_display} fps (${v.fps.toFixed(4)})`} />
              <Row
                label={t('details.videoBitrate')}
                value={
                  effectiveVideoBitrate
                    ? `${formatBitrate(effectiveVideoBitrate)}${!v.bit_rate ? t('details.estimatedBitrate') : ''}`
                    : t('details.unknown')
                }
              />
              <Row
                label={t('details.bitDepthPixFmt')}
                value={`${v.bit_depth ? `${v.bit_depth}-bit` : t('details.unknown')} · ${v.pix_fmt || t('details.unknown')}${v.chroma_location ? ` (${v.chroma_location})` : ''}`}
              />
              <Row
                label={t('details.dynamicRange')}
                value={
                  v.is_hdr ? (
                    <span className="text-amber-300 font-semibold">{v.hdr_format || 'HDR'}</span>
                  ) : (
                    t('details.sdr')
                  )
                }
              />
              <Row
                label={t('details.colorInfo')}
                value={t('details.colorInfoVal', {
                  p: v.color_primaries || t('details.unknown'),
                  t: v.color_transfer || t('details.unknown'),
                  m: v.color_space || t('details.unknown'),
                  r: v.color_range || t('details.unknown'),
                })}
              />
              {v.master_display && <Row label={t('details.masterDisplay')} value={v.master_display} />}
              {v.max_cll && <Row label="MaxCLL / MaxFALL" value={v.max_cll} />}
              <Row
                label={t('details.scanBFramesKf')}
                value={t('details.scanVal', {
                  field: v.field_order || 'progressive',
                  b: v.has_b_frames ?? 'N/A',
                  k: media.keyframes.length,
                  tb: v.time_base_den,
                })}
              />
            </section>
          )}

          {/* Audio Streams */}
          {media.audio_tracks.length > 0 && (
            <section className="p-3.5 rounded-xl bg-white/[0.025] border border-white/[0.06] space-y-3">
              <div className="text-xs font-semibold text-emerald-300 flex items-center gap-1.5">
                <Volume2 className="w-3.5 h-3.5" />
                <span>{t('details.audioStreams', { n: media.audio_tracks.length })}</span>
              </div>
              {media.audio_tracks.map((a, idx) => (
                <div key={a.audio_index} className="pl-2 border-l-2 border-emerald-500/30">
                  <div className="text-[11px] font-semibold text-zinc-200 mb-1">
                    {t('details.audioTrackHeader', { n: idx + 1, s: a.stream_index })}
                    {a.is_default ? t('details.defaultTag') : ''}
                  </div>
                  <Row label={t('details.codec')} value={`${a.codec_long_name} (${a.codec_name.toUpperCase()})`} />
                  <Row
                    label={t('details.channelsRate')}
                    value={`${a.channel_layout} (${a.channels} ${t('details.channelsSuffix')}) · ${(a.sample_rate / 1000).toFixed(1)} kHz`}
                  />
                  <Row label={t('details.bitrate')} value={formatBitrate(a.bit_rate) || t('details.unknownVbr')} />
                  <Row
                    label={t('details.langTitle')}
                    value={`${a.language || t('details.unspecified')} / ${a.title || t('details.untitled')}`}
                  />
                </div>
              ))}
            </section>
          )}

          {/* Subtitle Streams */}
          {media.subtitle_tracks.length > 0 && (
            <section className="p-3.5 rounded-xl bg-white/[0.025] border border-white/[0.06] space-y-2.5">
              <div className="text-xs font-semibold text-sky-300 flex items-center gap-1.5">
                <Subtitles className="w-3.5 h-3.5" />
                <span>{t('details.subtitleStreams', { n: media.subtitle_tracks.length })}</span>
              </div>
              {media.subtitle_tracks.map((s, idx) => (
                <div key={s.subtitle_index} className="pl-2 border-l-2 border-sky-500/30">
                  <Row
                    label={t('details.subTrackLabel', { n: idx + 1, s: s.stream_index })}
                    value={`${t('details.subTrackVal', {
                      codec: s.codec_name.toUpperCase(),
                      lang: s.language || t('details.unspecified'),
                      title: s.title || t('details.untitled'),
                    })}${s.is_default ? t('details.defaultTag') : ''}`}
                  />
                </div>
              ))}
            </section>
          )}
        </div>
      </div>
    </div>
  );
};
