import React, { useState } from 'react';
import { X, Copy, Check, Film, Volume2, Subtitles, FileText } from 'lucide-react';
import type { MediaInfo } from '../types/media';
import { formatBitrate, formatBytes, formatTimecode } from '../utils/timecode';

interface MediaDetailsModalProps {
  media: MediaInfo | null;
  open: boolean;
  onClose: () => void;
}

function buildPlainTextReport(media: MediaInfo): string {
  const lines: string[] = [];
  lines.push('【常规信息】');
  lines.push(`文件名: ${media.file_name}`);
  lines.push(`完整路径: ${media.file_path}`);
  lines.push(`封装格式: ${media.format_long_name} (${media.format_name})`);
  lines.push(`文件大小: ${formatBytes(media.file_size)} (${media.file_size.toLocaleString()} 字节)`);
  lines.push(`时长: ${formatTimecode(media.duration, true)}`);
  if (media.bit_rate) lines.push(`总码率: ${formatBitrate(media.bit_rate)}`);
  lines.push(`流总数: ${media.nb_streams} · 章节数: ${media.nb_chapters}`);
  if (media.encoder_tag) lines.push(`封装程序: ${media.encoder_tag}`);

  if (media.video) {
    const v = media.video;
    lines.push('');
    lines.push('【视频流】');
    lines.push(`编码器: ${v.codec_long_name} (${v.codec_name})`);
    if (v.profile) lines.push(`Profile / Level: ${v.profile}${v.level ? ` @ L${(v.level / 10).toFixed(1)}` : ''}`);
    lines.push(`分辨率: ${v.width} × ${v.height}${v.dar ? ` (DAR ${v.dar}` : ''}${v.sar ? `, SAR ${v.sar})` : v.dar ? ')' : ''}`);
    lines.push(`帧率: ${v.fps_display} fps (${v.fps.toFixed(6)})`);
    lines.push(`视频码率: ${formatBitrate(v.bit_rate || media.bit_rate) || '未知'}`);
    lines.push(`位深 / 像素格式: ${v.bit_depth ? `${v.bit_depth}-bit` : '未知'} / ${v.pix_fmt || '未知'}`);
    lines.push(`动态范围: ${v.is_hdr ? v.hdr_format || 'HDR' : 'SDR'}`);
    lines.push(
      `色彩参数: Primaries=${v.color_primaries || 'N/A'}, Transfer=${v.color_transfer || 'N/A'}, Matrix=${v.color_space || 'N/A'}, Range=${v.color_range || 'N/A'}`
    );
    if (v.master_display) lines.push(`HDR10 主显示元数据: ${v.master_display}`);
    if (v.max_cll) lines.push(`HDR10 亮度峰值 (MaxCLL/MaxFALL): ${v.max_cll}`);
    lines.push(`关键帧数量: ${media.keyframes.length}`);
  }

  media.audio_tracks.forEach((a, i) => {
    lines.push('');
    lines.push(`【音频流 #${i + 1}】`);
    lines.push(`编码器: ${a.codec_long_name} (${a.codec_name})`);
    lines.push(`声道 / 采样率: ${a.channel_layout} (${a.channels} ch) · ${(a.sample_rate / 1000).toFixed(1)} kHz`);
    if (a.bit_rate) lines.push(`码率: ${formatBitrate(a.bit_rate)}`);
    if (a.language) lines.push(`语言: ${a.language}`);
    if (a.title) lines.push(`标题: ${a.title}`);
  });

  media.subtitle_tracks.forEach((s, i) => {
    lines.push('');
    lines.push(`【字幕流 #${i + 1}】`);
    lines.push(`格式: ${s.codec_long_name} (${s.codec_name})`);
    if (s.language) lines.push(`语言: ${s.language}`);
    if (s.title) lines.push(`标题: ${s.title}`);
  });

  return lines.join('\n');
}

const Row: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="grid grid-cols-[130px_1fr] gap-2 py-1 border-b border-white/[0.04] text-[11px]">
    <span className="text-zinc-500 shrink-0">{label}</span>
    <span className="text-zinc-200 font-mono-num break-all">{value}</span>
  </div>
);

export const MediaDetailsModal: React.FC<MediaDetailsModalProps> = ({ media, open, onClose }) => {
  const [copied, setCopied] = useState(false);

  if (!open || !media) return null;

  const v = media.video;
  const effectiveVideoBitrate = v?.bit_rate || media.bit_rate;

  const handleCopy = () => {
    navigator.clipboard?.writeText(buildPlainTextReport(media)).then(() => {
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
              <div className="text-sm font-semibold text-white truncate">媒体文件详细属性</div>
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
                  <span className="text-emerald-300">已复制</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5 text-zinc-400" />
                  <span>复制属性</span>
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
              <span>常规信息 (General)</span>
            </div>
            <Row label="完整路径" value={media.file_path} />
            <Row label="封装格式" value={`${media.format_long_name} (${media.format_name})`} />
            <Row
              label="文件大小"
              value={`${formatBytes(media.file_size)} (${media.file_size.toLocaleString()} Bytes)`}
            />
            <Row label="总时长" value={formatTimecode(media.duration, true)} />
            <Row label="总码率" value={formatBitrate(media.bit_rate) || '未知'} />
            <Row
              label="流统计"
              value={`共 ${media.nb_streams} 条流（视频 ${v ? 1 : 0} · 音频 ${media.audio_tracks.length} · 字幕 ${media.subtitle_tracks.length}）· 章节 ${media.nb_chapters}`}
            />
            {media.encoder_tag && <Row label="封装工具" value={media.encoder_tag} />}
          </section>

          {/* Video Stream */}
          {v && (
            <section className="p-3.5 rounded-xl bg-white/[0.025] border border-white/[0.06]">
              <div className="text-xs font-semibold text-amber-300 mb-2 flex items-center gap-1.5">
                <Film className="w-3.5 h-3.5" />
                <span>视频流 (Video · Stream #{v.stream_index})</span>
              </div>
              <Row label="视频编码" value={`${v.codec_long_name} (${v.codec_name.toUpperCase()})`} />
              <Row
                label="Profile / Level"
                value={`${v.profile || 'N/A'}${v.level ? ` @ L${(v.level / 10).toFixed(1)}` : ''}`}
              />
              <Row
                label="分辨率 / 比例"
                value={`${v.width} × ${v.height}${v.dar ? ` · DAR ${v.dar}` : ''}${v.sar ? ` · SAR ${v.sar}` : ''}`}
              />
              <Row label="帧率 (FPS)" value={`${v.fps_display} fps (${v.fps.toFixed(4)})`} />
              <Row
                label="视频码率"
                value={
                  effectiveVideoBitrate
                    ? `${formatBitrate(effectiveVideoBitrate)}${!v.bit_rate ? ' (总码率估算)' : ''}`
                    : '未知'
                }
              />
              <Row
                label="位深 / 像素格式"
                value={`${v.bit_depth ? `${v.bit_depth}-bit` : '未知'} · ${v.pix_fmt || '未知'}${v.chroma_location ? ` (${v.chroma_location})` : ''}`}
              />
              <Row
                label="动态范围 (HDR)"
                value={
                  v.is_hdr ? (
                    <span className="text-amber-300 font-semibold">{v.hdr_format || 'HDR'}</span>
                  ) : (
                    'SDR (标准动态范围)'
                  )
                }
              />
              <Row
                label="色彩信息"
                value={`色域: ${v.color_primaries || '未知'} · 传递: ${v.color_transfer || '未知'} · 矩阵: ${v.color_space || '未知'} · 范围: ${v.color_range || '未知'}`}
              />
              {v.master_display && <Row label="HDR10 主显示" value={v.master_display} />}
              {v.max_cll && <Row label="MaxCLL / MaxFALL" value={v.max_cll} />}
              <Row
                label="扫描 / B帧 / 关键帧"
                value={`${v.field_order || 'progressive'} · B帧缓冲: ${v.has_b_frames ?? 'N/A'} · 关键帧: ${media.keyframes.length} 个 · Timebase: 1/${v.time_base_den}`}
              />
            </section>
          )}

          {/* Audio Streams */}
          {media.audio_tracks.length > 0 && (
            <section className="p-3.5 rounded-xl bg-white/[0.025] border border-white/[0.06] space-y-3">
              <div className="text-xs font-semibold text-emerald-300 flex items-center gap-1.5">
                <Volume2 className="w-3.5 h-3.5" />
                <span>音频流 ({media.audio_tracks.length} 条)</span>
              </div>
              {media.audio_tracks.map((a, idx) => (
                <div key={a.audio_index} className="pl-2 border-l-2 border-emerald-500/30">
                  <div className="text-[11px] font-semibold text-zinc-200 mb-1">
                    音轨 #{idx + 1} (Stream #{a.stream_index}){a.is_default ? ' · 默认' : ''}
                  </div>
                  <Row label="编码格式" value={`${a.codec_long_name} (${a.codec_name.toUpperCase()})`} />
                  <Row
                    label="声道 / 采样率"
                    value={`${a.channel_layout} (${a.channels} 声道) · ${(a.sample_rate / 1000).toFixed(1)} kHz`}
                  />
                  <Row label="码率" value={formatBitrate(a.bit_rate) || '未知 / VBR'} />
                  <Row label="语言 / 名称" value={`${a.language || '未指定'} / ${a.title || '无标题'}`} />
                </div>
              ))}
            </section>
          )}

          {/* Subtitle Streams */}
          {media.subtitle_tracks.length > 0 && (
            <section className="p-3.5 rounded-xl bg-white/[0.025] border border-white/[0.06] space-y-2.5">
              <div className="text-xs font-semibold text-sky-300 flex items-center gap-1.5">
                <Subtitles className="w-3.5 h-3.5" />
                <span>字幕流 ({media.subtitle_tracks.length} 条)</span>
              </div>
              {media.subtitle_tracks.map((s, idx) => (
                <div key={s.subtitle_index} className="pl-2 border-l-2 border-sky-500/30">
                  <Row
                    label={`字幕 #${idx + 1} (Stream #${s.stream_index})`}
                    value={`${s.codec_name.toUpperCase()} · 语言: ${s.language || '未指定'} · 名称: ${s.title || '无标题'}${s.is_default ? ' · 默认' : ''}`}
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
