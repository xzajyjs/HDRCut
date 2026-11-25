import type {
  HDRCutProjectFile,
  MissingMediaItem,
  SavedProjectTab,
  TabSession,
} from '../types/media';

function baseFileName(filePath: string): string {
  const idx = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  return idx >= 0 ? filePath.slice(idx + 1) : filePath;
}

export function serializeProject(
  tabs: TabSession[],
  activeTabId: string,
  projectName: string,
  appVersion: string
): HDRCutProjectFile {
  const activeIdx = Math.max(
    0,
    tabs.findIndex((t) => t.id === activeTabId)
  );

  const savedTabs: SavedProjectTab[] = tabs.map((tab) => ({
    video_path: tab.media?.file_path ?? null,
    video_name: tab.media?.file_name ?? null,
    playback_time: tab.playerState.time_pos || 0,
    volume: tab.playerState.volume ?? 100,
    speed: tab.playerState.speed ?? 1,
    hdr_passthrough: tab.playerState.hdr_passthrough ?? true,
    active_audio_aid: tab.playerState.aid ?? 1,
    active_subtitle_sid: tab.playerState.sid ?? 0,
    active_panel_tab: tab.activePanelTab,
    cut_mode: tab.cutMode,
    ranges: tab.ranges.map((r) => ({ id: r.id, start: r.start, end: r.end })),
    draft_in: tab.draftIn,
    draft_out: tab.draftOut,
    smart_cut: tab.smartCut,
    audio_tracks: tab.audioTracks.map((a) => ({
      source_kind: a.source_kind,
      audio_index: a.audio_index,
      file_path: a.file_path,
      file_name: a.file_path ? baseFileName(a.file_path) : a.original_title || a.title,
      title: a.title,
      language: a.language,
      enabled: a.enabled,
      is_default: a.is_default,
    })),
    mixed_tracks: tab.mixedTracks.map((m) => ({
      ...m,
      source_audio_indices: [...m.source_audio_indices],
      gains_db: { ...m.gains_db },
    })),
    subtitle_tracks: tab.subtitleTracks.map((s) => ({
      source_kind: s.source_kind,
      subtitle_index: s.subtitle_index,
      file_path: s.file_path,
      file_name: s.file_path ? baseFileName(s.file_path) : s.title,
      title: s.title,
      language: s.language,
      enabled: s.enabled,
      is_default: s.is_default,
      delay_sec: s.delay_sec || 0,
    })),
    output_dir: tab.outputDir,
    export_format: tab.exportFormat,
  }));

  return {
    format: 'hdrcut-project',
    schema_version: 1,
    app_version: appVersion,
    saved_at: new Date().toISOString(),
    name: projectName,
    active_tab_index: activeIdx,
    tabs: savedTabs,
  };
}

export function parseProjectFile(raw: string): HDRCutProjectFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Invalid JSON in project file');
  }
  const obj = parsed as Partial<HDRCutProjectFile> | null;
  if (!obj || obj.format !== 'hdrcut-project' || !Array.isArray(obj.tabs)) {
    throw new Error('Not a valid HDRCut project (.hdrcut) file');
  }
  return {
    format: 'hdrcut-project',
    schema_version: 1,
    app_version: obj.app_version || '1.0.0',
    saved_at: obj.saved_at || '',
    name: obj.name || 'HDRCut Project',
    active_tab_index:
      typeof obj.active_tab_index === 'number' && obj.active_tab_index >= 0
        ? obj.active_tab_index
        : 0,
    tabs: obj.tabs,
  };
}

export interface ProjectMediaRef {
  key: string;
  tabIndex: number;
  tabLabel: string;
  kind: 'video' | 'audio' | 'subtitle';
  trackIndex?: number;
  originalPath: string;
  fileName: string;
}

export function collectProjectMediaRefs(project: HDRCutProjectFile): ProjectMediaRef[] {
  const refs: ProjectMediaRef[] = [];
  project.tabs.forEach((tab, tabIndex) => {
    const tabLabel = tab.video_name || `Tab #${tabIndex + 1}`;
    if (tab.video_path) {
      refs.push({
        key: `tab_${tabIndex}_video`,
        tabIndex,
        tabLabel,
        kind: 'video',
        originalPath: tab.video_path,
        fileName: tab.video_name || baseFileName(tab.video_path),
      });
    }
    (tab.audio_tracks || []).forEach((a, idx) => {
      if (a.source_kind === 'external' && a.file_path) {
        refs.push({
          key: `tab_${tabIndex}_audio_${idx}`,
          tabIndex,
          tabLabel,
          kind: 'audio',
          trackIndex: idx,
          originalPath: a.file_path,
          fileName: a.file_name || baseFileName(a.file_path),
        });
      }
    });
    (tab.subtitle_tracks || []).forEach((s, idx) => {
      if (s.source_kind === 'external' && s.file_path) {
        refs.push({
          key: `tab_${tabIndex}_sub_${idx}`,
          tabIndex,
          tabLabel,
          kind: 'subtitle',
          trackIndex: idx,
          originalPath: s.file_path,
          fileName: s.file_name || baseFileName(s.file_path),
        });
      }
    });
  });
  return refs;
}

/** Applies relinked paths & skipped flags onto a cloned project before hydration. */
export function applyRelinkDecisions(
  project: HDRCutProjectFile,
  missingItems: MissingMediaItem[]
): HDRCutProjectFile {
  const byKey = new Map(missingItems.map((m) => [m.key, m]));
  const clonedTabs: SavedProjectTab[] = project.tabs.map((tab, tabIndex) => {
    const vidMissing = byKey.get(`tab_${tabIndex}_video`);
    let nextVideoPath = tab.video_path;
    let nextVideoName = tab.video_name;
    if (vidMissing) {
      if (vidMissing.relinkedPath) {
        nextVideoPath = vidMissing.relinkedPath;
        nextVideoName = baseFileName(vidMissing.relinkedPath);
      } else {
        // Skipped or unresolved main video -> load tab without video
        nextVideoPath = null;
        nextVideoName = null;
      }
    }

    const nextAudio = (tab.audio_tracks || []).flatMap((a, idx) => {
      if (a.source_kind !== 'external') return [a];
      const item = byKey.get(`tab_${tabIndex}_audio_${idx}`);
      if (!item) return [a];
      if (item.relinkedPath) {
        return [{ ...a, file_path: item.relinkedPath, file_name: baseFileName(item.relinkedPath) }];
      }
      return [];
    });

    const nextSubs = (tab.subtitle_tracks || []).flatMap((s, idx) => {
      if (s.source_kind !== 'external') return [s];
      const item = byKey.get(`tab_${tabIndex}_sub_${idx}`);
      if (!item) return [s];
      if (item.relinkedPath) {
        return [{ ...s, file_path: item.relinkedPath, file_name: baseFileName(item.relinkedPath) }];
      }
      return [];
    });

    return {
      ...tab,
      video_path: nextVideoPath,
      video_name: nextVideoName,
      audio_tracks: nextVideoPath ? nextAudio : [],
      subtitle_tracks: nextVideoPath ? nextSubs : [],
      mixed_tracks: nextVideoPath ? tab.mixed_tracks || [] : [],
    };
  });

  return { ...project, tabs: clonedTabs };
}
