import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { open, save } from '@tauri-apps/plugin-dialog';
import { Scissors, Volume2, Subtitles } from 'lucide-react';

import type {
  CutRange,
  EditableAudioTrack,
  EditableSubtitleTrack,
  ExportProgressEvent,
  ExternalAudioInfo,
  ExternalSubtitleInfo,
  HDRCutProjectFile,
  MediaInfo,
  MissingMediaItem,
  PlayerStateEvent,
  TabSession,
  ToolStatus,
  UpdateCheckResult,
  UpdateProgressEvent,
} from './types/media';
import { computeKeptSegments, snapToNearestKeyframe, stepKeyframe } from './utils/segments';
import {
  applyRelinkDecisions,
  collectProjectMediaRefs,
  parseProjectFile,
  serializeProject,
} from './utils/project';
import { TabBar } from './components/TabBar';
import { TopBar } from './components/TopBar';
import { VideoViewport } from './components/VideoViewport';
import { PlaybackControls } from './components/PlaybackControls';
import { Timeline } from './components/Timeline';
import { CutListPanel } from './components/CutListPanel';
import { AudioTrackPanel } from './components/AudioTrackPanel';
import { SubtitlePanel } from './components/SubtitlePanel';
import { ExportProgressBar } from './components/ExportProgressBar';
import { MediaDetailsModal } from './components/MediaDetailsModal';
import { LanguageModal } from './components/LanguageModal';
import { UpdateModal } from './components/UpdateModal';
import { MissingMediaModal } from './components/MissingMediaModal';
import { useI18n } from './i18n';

const INITIAL_PLAYER_STATE: PlayerStateEvent = {
  time_pos: 0,
  duration: 0,
  paused: true,
  volume: 100,
  speed: 1,
  aid: 1,
  sid: 1,
  eof_reached: false,
  hdr_passthrough: true,
};

function createEmptyTab(defaultOutputDir = ''): TabSession {
  return {
    id: `tab_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    media: null,
    isAnalyzing: false,
    playerError: null,
    playerState: { ...INITIAL_PLAYER_STATE },
    activePanelTab: 'cut',
    cutMode: 'remove',
    ranges: [],
    draftIn: null,
    draftOut: null,
    smartCut: true,
    audioTracks: [],
    mixedTracks: [],
    subtitleTracks: [],
    outputDir: defaultOutputDir,
    exportFormat: 'mkv',
  };
}

function getDirName(filePath: string): string {
  const idx = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  return idx > 0 ? filePath.slice(0, idx) : '';
}

function getBaseNameWithoutExt(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot > 0 ? fileName.slice(0, dot) : fileName;
}

function joinPath(dir: string, fileName: string): string {
  const sep = dir.includes('\\') ? '\\' : '/';
  const cleanDir = dir.replace(/[\\/]+$/, '');
  return `${cleanDir}${sep}${fileName}`;
}

function sanitizeFilePart(s: string): string {
  return s.replace(/[\\/:*?"<>|]/g, '_').trim();
}

function buildExportSubtitleFileName(
  videoBaseName: string,
  trackOrderZeroBased: number,
  title: string,
  language: string,
  ext: string
): string {
  const num = String(trackOrderZeroBased + 1).padStart(2, '0');
  const safeTitle = sanitizeFilePart(title || `sub${trackOrderZeroBased + 1}`);
  const safeLang = sanitizeFilePart(language || '').toLowerCase();
  const langSuffix = safeLang ? ` [${safeLang}]` : '';
  return `${videoBaseName} - ${num}_${safeTitle}${langSuffix}.${ext}`;
}

function audioExtForCodec(codec: string): string {
  const c = codec.toLowerCase();
  if (c === 'aac') return 'm4a';
  if (c === 'flac') return 'flac';
  if (c === 'ac3') return 'ac3';
  if (c === 'eac3') return 'eac3';
  if (c.startsWith('dts')) return 'dts';
  if (c === 'truehd') return 'thd';
  if (c === 'opus') return 'opus';
  if (c === 'mp3') return 'mp3';
  if (c === 'vorbis') return 'ogg';
  if (c.startsWith('pcm_')) return 'wav';
  if (c === 'alac') return 'm4a';
  return 'mka';
}

function subtitleExtForCodec(codec: string): string {
  const c = codec.toLowerCase();
  if (c === 'ass' || c === 'ssa') return 'ass';
  if (c === 'webvtt') return 'vtt';
  if (c === 'hdmv_pgs_subtitle') return 'sup';
  return 'srt';
}

const APP_VERSION = '1.6.7';
const AUTO_UPDATE_STORAGE_KEY = 'hdrcut.autoUpdate';
const MAX_HISTORY_STEPS = 80;

interface WorkspaceSnapshot {
  tabs: TabSession[];
  activeTabId: string;
}

function cloneTabsForHistory(list: TabSession[]): TabSession[] {
  return list.map((tab) => ({
    ...tab,
    // MediaInfo is immutable after analysis and holds large keyframe arrays
    media: tab.media,
    isAnalyzing: false,
    playerState: { ...tab.playerState },
    ranges: tab.ranges.map((r) => ({ ...r })),
    audioTracks: tab.audioTracks.map((a) => ({ ...a })),
    mixedTracks: tab.mixedTracks.map((m) => ({
      ...m,
      source_audio_indices: [...m.source_audio_indices],
      gains_db: { ...m.gains_db },
    })),
    subtitleTracks: tab.subtitleTracks.map((s) => ({ ...s })),
  }));
}

function needsFullPlayerResync(
  a: TabSession | undefined,
  b: TabSession | undefined
): boolean {
  if (!a || !b) return true;
  if (a.id !== b.id) return true;
  if ((a.media?.file_path ?? null) !== (b.media?.file_path ?? null)) return true;
  const extA1 = a.audioTracks
    .filter((x) => x.source_kind === 'external')
    .map((x) => x.file_path || '');
  const extA2 = b.audioTracks
    .filter((x) => x.source_kind === 'external')
    .map((x) => x.file_path || '');
  if (extA1.length !== extA2.length || extA1.some((p, i) => p !== extA2[i])) return true;
  const extS1 = a.subtitleTracks
    .filter((x) => x.source_kind === 'external')
    .map((x) => x.file_path || '');
  const extS2 = b.subtitleTracks
    .filter((x) => x.source_kind === 'external')
    .map((x) => x.file_path || '');
  if (extS1.length !== extS2.length || extS1.some((p, i) => p !== extS2[i])) return true;
  return false;
}

function loadAutoUpdatePref(): boolean {
  try {
    return window.localStorage.getItem(AUTO_UPDATE_STORAGE_KEY) !== 'false';
  } catch {
    return true;
  }
}

export function App() {
  const { t, needsLanguageSetup } = useI18n();
  const [toolStatus, setToolStatus] = useState<ToolStatus | null>(null);
  const [isNativeReady, setIsNativeReady] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [skimmingEnabled, setSkimmingEnabled] = useState(false);

  // Auto-update state (background check on startup + manual check + full self-update)
  const [autoUpdateEnabled, setAutoUpdateEnabled] = useState<boolean>(loadAutoUpdatePref);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [updateCheckResult, setUpdateCheckResult] = useState<UpdateCheckResult | null>(null);
  const [updateCheckError, setUpdateCheckError] = useState<string | null>(null);
  const [updateProgress, setUpdateProgress] = useState<UpdateProgressEvent | null>(null);
  const autoUpdateTriggeredRef = useRef(false);

  // Multi-tab state (each tab holds completely independent video & edit configurations)
  const [tabs, setTabs] = useState<TabSession[]>(() => [createEmptyTab()]);
  const [activeTabId, setActiveTabId] = useState<string>(() => '');

  // Ensure activeTabId always points to a valid tab
  const effectiveActiveTabId = useMemo(() => {
    if (activeTabId && tabs.some((t) => t.id === activeTabId)) return activeTabId;
    return tabs[0]?.id || '';
  }, [activeTabId, tabs]);

  const activeTab = useMemo(
    () => tabs.find((t) => t.id === effectiveActiveTabId) || tabs[0],
    [tabs, effectiveActiveTabId]
  );

  // Refs for fresh state inside native Tauri event callbacks
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const activeTabIdRef = useRef(effectiveActiveTabId);
  activeTabIdRef.current = effectiveActiveTabId;
  const switchGuardUntilRef = useRef(0);

  // Global Undo / Redo history stacks (covers all tabs, cuts, audio, subtitles, project loads)
  const historyRef = useRef<{
    past: WorkspaceSnapshot[];
    future: WorkspaceSnapshot[];
    lastKey: string;
    lastAt: number;
  }>({
    past: [],
    future: [],
    lastKey: '',
    lastAt: 0,
  });
  const [historyCounts, setHistoryCounts] = useState({ past: 0, future: 0 });
  const lastUndoRedoAtRef = useRef(0);

  const recordHistory = useCallback((coalesceKey?: string) => {
    const now = performance.now();
    const h = historyRef.current;
    if (
      coalesceKey &&
      h.lastKey === coalesceKey &&
      now - h.lastAt < 650 &&
      h.past.length > 0
    ) {
      h.lastAt = now;
      if (h.future.length > 0) {
        h.future = [];
        setHistoryCounts({ past: h.past.length, future: 0 });
      }
      return;
    }

    const snap: WorkspaceSnapshot = {
      tabs: cloneTabsForHistory(tabsRef.current),
      activeTabId: activeTabIdRef.current,
    };
    h.past.push(snap);
    if (h.past.length > MAX_HISTORY_STEPS) {
      h.past.shift();
    }
    h.future = [];
    h.lastKey = coalesceKey || '';
    h.lastAt = now;
    setHistoryCounts({ past: h.past.length, future: 0 });
  }, []);

  // Project (.hdrcut) state & missing media relink modal state
  const [currentProjectPath, setCurrentProjectPath] = useState<string | null>(null);
  const currentProjectPathRef = useRef(currentProjectPath);
  currentProjectPathRef.current = currentProjectPath;
  const [pendingProject, setPendingProject] = useState<HDRCutProjectFile | null>(null);
  const [pendingProjectPath, setPendingProjectPath] = useState<string | null>(null);
  const [missingMediaItems, setMissingMediaItems] = useState<MissingMediaItem[]>([]);
  const [isLoadingProject, setIsLoadingProject] = useState(false);
  const isLoadingProjectRef = useRef(isLoadingProject);
  isLoadingProjectRef.current = isLoadingProject;

  const currentProjectName = useMemo(() => {
    if (!currentProjectPath) return null;
    const idx = Math.max(currentProjectPath.lastIndexOf('/'), currentProjectPath.lastIndexOf('\\'));
    const base = idx >= 0 ? currentProjectPath.slice(idx + 1) : currentProjectPath;
    return base.replace(/\.hdrcut$/i, '') || base;
  }, [currentProjectPath]);

  // Final Cut Pro–style timeline skimming state (keeps cyan playhead anchored while previewing hover frame)
  const skimRef = useRef<{
    active: boolean;
    anchorTime: number;
    currentSkimTime: number;
    wasPlaying: boolean;
    lastSeekAt: number;
    exactTimer: number | null;
  }>({
    active: false,
    anchorTime: 0,
    currentSkimTime: 0,
    wasPlaying: false,
    lastSeekAt: 0,
    exactTimer: null,
  });

  const clearSkimTimer = useCallback(() => {
    if (skimRef.current.exactTimer !== null) {
      window.clearTimeout(skimRef.current.exactTimer);
      skimRef.current.exactTimer = null;
    }
  }, []);

  const handleSkimEnd = useCallback(
    (restoreFrame = true) => {
      clearSkimTimer();
      if (!skimRef.current.active) return;
      const { anchorTime, wasPlaying } = skimRef.current;
      skimRef.current.active = false;
      if (restoreFrame) {
        switchGuardUntilRef.current = performance.now() + 200;
        invoke('player_seek', { seconds: anchorTime, exact: true }).catch(() => {});
        if (wasPlaying) {
          invoke('player_set_pause', { paused: false }).catch(() => {});
        }
      }
    },
    [clearSkimTimer]
  );

  const handleToggleSkimming = useCallback(() => {
    setSkimmingEnabled((prev) => {
      if (prev) handleSkimEnd(true);
      return !prev;
    });
  }, [handleSkimEnd]);

  // Global export / extraction progress bar
  const [exportProgress, setExportProgress] = useState<ExportProgressEvent | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);

  const isExporting = exportProgress?.status === 'running' || isExtracting;
  const isExportingRef = useRef(isExporting);
  isExportingRef.current = isExporting;

  // Auto-Update Actions
  const handleToggleAutoUpdate = useCallback((enabled: boolean) => {
    setAutoUpdateEnabled(enabled);
    try {
      window.localStorage.setItem(AUTO_UPDATE_STORAGE_KEY, enabled ? 'true' : 'false');
    } catch {
      // ignore storage errors
    }
  }, []);

  const handleInstallUpdate = useCallback(async (resOverride?: UpdateCheckResult) => {
    const target = resOverride ?? updateCheckResult;
    if (!target || !target.has_update || !target.asset_url || !target.asset_name) return;
    if (isExportingRef.current) return;

    setUpdateProgress({
      stage: 'downloading',
      percent: 0,
      downloaded_bytes: 0,
      total_bytes: target.asset_size,
      message: '0%',
    });

    try {
      await invoke('install_app_update', {
        assetUrl: target.asset_url,
        assetName: target.asset_name,
        assetSize: target.asset_size,
      });
    } catch (err) {
      const msg = String(err);
      if (msg === 'CANCELLED') {
        setUpdateProgress(null);
      } else {
        setUpdateProgress({
          stage: 'error',
          percent: 0,
          downloaded_bytes: 0,
          total_bytes: target.asset_size,
          message: msg,
        });
      }
    }
  }, [updateCheckResult]);

  const handleCancelUpdate = useCallback(() => {
    invoke('cancel_app_update').catch(() => {});
  }, []);

  const handleCheckUpdate = useCallback(
    async (isBackgroundAuto = false) => {
      setIsCheckingUpdate(true);
      if (!isBackgroundAuto) {
        setUpdateCheckError(null);
      }
      try {
        const res = await invoke<UpdateCheckResult>('check_app_update');
        setUpdateCheckResult(res);
        setUpdateCheckError(null);

        // Fully automatic download & install when launched with auto-update enabled
        if (
          isBackgroundAuto &&
          res.has_update &&
          res.can_self_update &&
          res.asset_url &&
          res.asset_name &&
          !isExportingRef.current &&
          !autoUpdateTriggeredRef.current
        ) {
          autoUpdateTriggeredRef.current = true;
          void handleInstallUpdate(res);
        }
      } catch (err) {
        if (!isBackgroundAuto) {
          setUpdateCheckError(String(err));
        }
      } finally {
        setIsCheckingUpdate(false);
      }
    },
    [handleInstallUpdate]
  );

  const handleCheckUpdateRef = useRef(handleCheckUpdate);
  handleCheckUpdateRef.current = handleCheckUpdate;

  // Startup background auto-check (when auto-update setting is enabled)
  useEffect(() => {
    if (!autoUpdateEnabled) return;
    const timer = window.setTimeout(() => {
      void handleCheckUpdateRef.current(true);
    }, 2200);
    return () => window.clearTimeout(timer);
    // Run once on startup based on initial preference
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Helper to update a specific tab (defaults to active tab)
  const updateTab = useCallback((tabId: string, updater: (prev: TabSession) => TabSession) => {
    setTabs((prev) => prev.map((t) => (t.id === tabId ? updater(t) : t)));
  }, []);

  const updateActiveTab = useCallback(
    (updater: (prev: TabSession) => TabSession) => {
      const id = activeTabIdRef.current;
      if (!id) return;
      setTabs((prev) => prev.map((t) => (t.id === id ? updater(t) : t)));
    },
    []
  );

  // Sync the single shared native libmpv engine to a given TabSession
  const syncPlayerToTab = useCallback(async (tab: TabSession) => {
    switchGuardUntilRef.current = performance.now() + 450;

    if (!tab.media) {
      await invoke('player_stop').catch(() => {});
      return;
    }

    try {
      await invoke<string>('player_init');
      setIsNativeReady(true);
      await invoke('player_load', {
        filePath: tab.media.file_path,
        hdrFormat: tab.media.video?.hdr_format ?? null,
        startTime: tab.playerState.time_pos > 0.05 ? tab.playerState.time_pos : null,
        startPaused: true,
      });

      // Re-attach external audio & subtitle files and capture exact libmpv-assigned IDs
      const newAidMap = new Map<string, number>();
      for (const extA of tab.audioTracks) {
        if (extA.source_kind === 'external' && extA.file_path) {
          const assignedAid = await invoke<number>('player_add_audio_file', {
            filePath: extA.file_path,
          }).catch(() => extA.mpv_aid);
          newAidMap.set(extA.id, assignedAid);
        }
      }
      const newSidMap = new Map<string, number>();
      for (const extS of tab.subtitleTracks) {
        if (extS.source_kind === 'external' && extS.file_path) {
          const assignedSid = await invoke<number>('player_add_subtitle_file', {
            filePath: extS.file_path,
          }).catch(() => extS.mpv_sid);
          newSidMap.set(extS.id, assignedSid);
        }
      }

      const activeAudioTrack = tab.audioTracks.find((a) => a.mpv_aid === tab.playerState.aid);
      const restoredAid =
        (activeAudioTrack && newAidMap.get(activeAudioTrack.id)) ?? tab.playerState.aid;

      const activeSubTrack = tab.subtitleTracks.find((s) => s.mpv_sid === tab.playerState.sid);
      const restoredSid =
        (activeSubTrack && newSidMap.get(activeSubTrack.id)) ?? tab.playerState.sid;

      if (newAidMap.size > 0 || newSidMap.size > 0) {
        updateTab(tab.id, (prev) => ({
          ...prev,
          audioTracks: prev.audioTracks.map((a) =>
            newAidMap.has(a.id) ? { ...a, mpv_aid: newAidMap.get(a.id)! } : a
          ),
          subtitleTracks: prev.subtitleTracks.map((s) =>
            newSidMap.has(s.id) ? { ...s, mpv_sid: newSidMap.get(s.id)! } : s
          ),
          playerState: { ...prev.playerState, aid: restoredAid, sid: restoredSid },
        }));
      }

      // Restore tab's playback settings (audio track, subtitle track, sub delay, speed, volume, HDR)
      await invoke('player_set_audio_track', { aid: restoredAid }).catch(() => {});
      await invoke('player_set_subtitle_track', { sid: restoredSid }).catch(() => {});
      await invoke('player_set_sub_delay', { seconds: activeSubTrack?.delay_sec ?? 0 }).catch(
        () => {}
      );
      await invoke('player_set_speed', { speed: tab.playerState.speed }).catch(() => {});
      await invoke('player_set_volume', { volume: tab.playerState.volume }).catch(() => {});
      await invoke('player_set_hdr', { enabled: tab.playerState.hdr_passthrough }).catch(() => {});
    } catch (err) {
      updateTab(tab.id, (prev) => ({
        ...prev,
        playerError: t('msg.switchLoadFail', { err: String(err) }),
      }));
    }
  }, [t, updateTab]);

  // Global Undo / Redo execution
  const applyHistoryStep = useCallback(
    async (direction: 'undo' | 'redo') => {
      if (isExportingRef.current || isLoadingProjectRef.current) return;
      const h = historyRef.current;
      const sourceStack = direction === 'undo' ? h.past : h.future;
      const targetStack = direction === 'undo' ? h.future : h.past;
      if (sourceStack.length === 0) return;

      handleSkimEnd(false);

      const currentSnap: WorkspaceSnapshot = {
        tabs: cloneTabsForHistory(tabsRef.current),
        activeTabId: activeTabIdRef.current,
      };
      const targetSnap = sourceStack.pop()!;
      targetStack.push(currentSnap);
      if (targetStack.length > MAX_HISTORY_STEPS) {
        targetStack.shift();
      }
      h.lastKey = '';
      h.lastAt = 0;
      setHistoryCounts({ past: h.past.length, future: h.future.length });

      const prevActive = tabsRef.current.find((tb) => tb.id === activeTabIdRef.current);
      const rawNextActive =
        targetSnap.tabs.find((tb) => tb.id === targetSnap.activeTabId) || targetSnap.tabs[0];

      const sameVideoInSameTab = Boolean(
        prevActive &&
          rawNextActive &&
          prevActive.id === rawNextActive.id &&
          (prevActive.media?.file_path ?? null) === (rawNextActive.media?.file_path ?? null)
      );

      // Keep live playhead when undoing/redoing edits on the same video
      const restoredTabs = sameVideoInSameTab
        ? targetSnap.tabs.map((tb) =>
            tb.id === rawNextActive!.id
              ? {
                  ...tb,
                  playerState: {
                    ...tb.playerState,
                    time_pos: prevActive!.playerState.time_pos,
                    paused: prevActive!.playerState.paused,
                  },
                }
              : tb
          )
        : targetSnap.tabs;

      const nextActive =
        restoredTabs.find((tb) => tb.id === targetSnap.activeTabId) || restoredTabs[0];

      setShowDetails(false);
      setTabs(restoredTabs);
      setActiveTabId(nextActive.id);
      activeTabIdRef.current = nextActive.id;

      if (needsFullPlayerResync(prevActive, nextActive)) {
        await syncPlayerToTab(nextActive);
      } else if (nextActive?.media) {
        if (prevActive && nextActive.playerState.aid !== prevActive.playerState.aid) {
          invoke('player_set_audio_track', { aid: nextActive.playerState.aid }).catch(() => {});
        }
        if (prevActive && nextActive.playerState.sid !== prevActive.playerState.sid) {
          invoke('player_set_subtitle_track', { sid: nextActive.playerState.sid }).catch(() => {});
        }
        const nextSub = nextActive.subtitleTracks.find(
          (s) => s.mpv_sid === nextActive.playerState.sid
        );
        const prevSub = prevActive?.subtitleTracks.find(
          (s) => s.mpv_sid === prevActive.playerState.sid
        );
        if (
          (nextSub?.delay_sec ?? 0) !== (prevSub?.delay_sec ?? 0) ||
          nextActive.playerState.sid !== prevActive?.playerState.sid
        ) {
          invoke('player_set_sub_delay', { seconds: nextSub?.delay_sec ?? 0 }).catch(() => {});
        }
      }
    },
    [handleSkimEnd, syncPlayerToTab]
  );

  const handleUndo = useCallback(() => {
    void applyHistoryStep('undo');
  }, [applyHistoryStep]);

  const handleRedo = useCallback(() => {
    void applyHistoryStep('redo');
  }, [applyHistoryStep]);

  // Project (.hdrcut) Save / Export / Import / Relink Missing Media
  const handleSaveProject = useCallback(
    async (forceSaveAs = false) => {
      if (isExportingRef.current || isLoadingProjectRef.current) return;

      let targetPath = !forceSaveAs ? currentProjectPathRef.current : null;
      if (!targetPath) {
        const curTab =
          tabsRef.current.find((tb) => tb.id === activeTabIdRef.current) || tabsRef.current[0];
        const fallbackDir =
          curTab?.outputDir || (curTab?.media ? getDirName(curTab.media.file_path) : '');
        const suggestedBase = curTab?.media
          ? getBaseNameWithoutExt(curTab.media.file_name)
          : 'HDRCut-Project';
        const defaultPath =
          currentProjectPathRef.current ||
          (fallbackDir ? joinPath(fallbackDir, `${suggestedBase}.hdrcut`) : `${suggestedBase}.hdrcut`);

        const chosen = await save({
          title: t('proj.saveDialogTitle'),
          defaultPath,
          filters: [{ name: t('proj.fileFilterName'), extensions: ['hdrcut'] }],
        });
        if (!chosen) return;
        targetPath = /\.hdrcut$/i.test(chosen) ? chosen : `${chosen}.hdrcut`;
      }

      const idx = Math.max(targetPath.lastIndexOf('/'), targetPath.lastIndexOf('\\'));
      const fileName = idx >= 0 ? targetPath.slice(idx + 1) : targetPath;
      const projName = fileName.replace(/\.hdrcut$/i, '') || 'HDRCut Project';

      try {
        const payload = serializeProject(
          tabsRef.current,
          activeTabIdRef.current,
          projName,
          APP_VERSION
        );
        await invoke('save_project', {
          filePath: targetPath,
          content: JSON.stringify(payload, null, 2),
        });
        setCurrentProjectPath(targetPath);
        setExportProgress({
          status: 'done',
          percent: 100,
          out_time_sec: 0,
          expected_duration_sec: 0,
          speed: '',
          written_bytes: 0,
          message: t('proj.savedToast', { name: fileName }),
          output_path: targetPath,
        });
      } catch (err) {
        setExportProgress({
          status: 'error',
          percent: 0,
          out_time_sec: 0,
          expected_duration_sec: 0,
          speed: '',
          written_bytes: 0,
          message: t('proj.saveFail', { err: String(err) }),
          output_path: targetPath,
        });
      }
    },
    [t]
  );

  const hydrateAndLoadProject = useCallback(
    async (project: HDRCutProjectFile, projectFilePath: string) => {
      setIsLoadingProject(true);
      setShowDetails(false);
      handleSkimEnd(false);

      setExportProgress({
        status: 'running',
        percent: 20,
        out_time_sec: 0,
        expected_duration_sec: 0,
        speed: '',
        written_bytes: 0,
        message: t('proj.loadingMsg'),
        output_path: projectFilePath,
      });

      try {
        const savedTabs = project.tabs.length > 0 ? project.tabs : [];
        const hydratedTabs: TabSession[] = [];

        for (let tabIdx = 0; tabIdx < savedTabs.length; tabIdx++) {
          const st = savedTabs[tabIdx];
          const baseTab = createEmptyTab(st.output_dir || '');
          baseTab.exportFormat = st.export_format === 'mp4' ? 'mp4' : 'mkv';
          baseTab.cutMode = st.cut_mode === 'keep' ? 'keep' : 'remove';
          baseTab.smartCut = st.smart_cut !== false;
          baseTab.activePanelTab =
            st.active_panel_tab === 'audio' || st.active_panel_tab === 'subtitle'
              ? st.active_panel_tab
              : 'cut';

          if (!st.video_path) {
            hydratedTabs.push(baseTab);
            continue;
          }

          try {
            const info = await invoke<MediaInfo>('analyze_media', { filePath: st.video_path });

            // Rebuild audio tracks (internal + external in saved order)
            const internalAudioMap = new Map(
              info.audio_tracks.map((tr) => [tr.audio_index, tr])
            );
            const rebuiltAudio: EditableAudioTrack[] = [];
            let nextTempAid = info.audio_tracks.length + 1;

            if (st.audio_tracks && st.audio_tracks.length > 0) {
              for (let ai = 0; ai < st.audio_tracks.length; ai++) {
                const sa = st.audio_tracks[ai];
                if (sa.source_kind === 'internal') {
                  const raw = internalAudioMap.get(sa.audio_index);
                  if (!raw) continue;
                  rebuiltAudio.push({
                    id: `int_a_${raw.audio_index}`,
                    source_kind: 'internal',
                    audio_index: raw.audio_index,
                    mpv_aid: raw.mpv_aid,
                    codec_name: raw.codec_name,
                    channel_layout: raw.channel_layout,
                    sample_rate: raw.sample_rate,
                    bit_rate: raw.bit_rate,
                    language: sa.language ?? raw.language ?? '',
                    title: sa.title || raw.title || `音轨 ${ai + 1}`,
                    original_title: raw.title || '',
                    enabled: sa.enabled,
                    is_default: sa.is_default,
                  });
                } else if (sa.source_kind === 'external' && sa.file_path) {
                  try {
                    const extInfo = await invoke<ExternalAudioInfo>('probe_external_audio_file', {
                      filePath: sa.file_path,
                    });
                    rebuiltAudio.push({
                      id: `ext_a_${Date.now()}_${tabIdx}_${ai}`,
                      source_kind: 'external',
                      audio_index: -1,
                      file_path: extInfo.file_path,
                      mpv_aid: nextTempAid++,
                      codec_name: extInfo.codec_name,
                      channel_layout: extInfo.channel_layout,
                      sample_rate: extInfo.sample_rate,
                      bit_rate: extInfo.bit_rate,
                      language: sa.language ?? extInfo.language ?? '',
                      title: sa.title || extInfo.title || getBaseNameWithoutExt(extInfo.file_name),
                      original_title: extInfo.title || extInfo.file_name,
                      enabled: sa.enabled,
                      is_default: sa.is_default,
                    });
                  } catch {
                    // Skip unreadable external audio file
                  }
                }
              }
            } else {
              info.audio_tracks.forEach((tr, i) => {
                rebuiltAudio.push({
                  id: `int_a_${tr.audio_index}`,
                  source_kind: 'internal',
                  audio_index: tr.audio_index,
                  mpv_aid: tr.mpv_aid,
                  codec_name: tr.codec_name,
                  channel_layout: tr.channel_layout,
                  sample_rate: tr.sample_rate,
                  bit_rate: tr.bit_rate,
                  language: tr.language || '',
                  title: tr.title || `音轨 ${i + 1}`,
                  original_title: tr.title || '',
                  enabled: true,
                  is_default: tr.is_default || i === 0,
                });
              });
            }

            // Rebuild subtitle tracks (internal + external in saved order)
            const internalSubMap = new Map(
              info.subtitle_tracks.map((s) => [s.subtitle_index, s])
            );
            const rebuiltSubs: EditableSubtitleTrack[] = [];
            let nextTempSid = info.subtitle_tracks.length + 1;

            if (st.subtitle_tracks && st.subtitle_tracks.length > 0) {
              for (let si = 0; si < st.subtitle_tracks.length; si++) {
                const ss = st.subtitle_tracks[si];
                if (ss.source_kind === 'internal' && ss.subtitle_index !== undefined) {
                  const raw = internalSubMap.get(ss.subtitle_index);
                  if (!raw) continue;
                  rebuiltSubs.push({
                    id: `int_s_${raw.subtitle_index}`,
                    source_kind: 'internal',
                    subtitle_index: raw.subtitle_index,
                    mpv_sid: raw.mpv_sid,
                    codec_name: raw.codec_name,
                    codec_long_name: raw.codec_long_name,
                    language: ss.language ?? raw.language ?? '',
                    title: ss.title || raw.title || `字幕 ${si + 1}`,
                    enabled: ss.enabled,
                    is_default: ss.is_default,
                    delay_sec: typeof ss.delay_sec === 'number' ? ss.delay_sec : 0,
                  });
                } else if (ss.source_kind === 'external' && ss.file_path) {
                  try {
                    const extInfo = await invoke<ExternalSubtitleInfo>(
                      'probe_external_subtitle_file',
                      { filePath: ss.file_path }
                    );
                    rebuiltSubs.push({
                      id: `ext_s_${Date.now()}_${tabIdx}_${si}`,
                      source_kind: 'external',
                      file_path: extInfo.file_path,
                      mpv_sid: nextTempSid++,
                      codec_name: extInfo.codec_name,
                      codec_long_name: extInfo.codec_name.toUpperCase(),
                      language: ss.language ?? extInfo.language ?? '',
                      title: ss.title || extInfo.title,
                      enabled: ss.enabled,
                      is_default: ss.is_default,
                      delay_sec: typeof ss.delay_sec === 'number' ? ss.delay_sec : 0,
                    });
                  } catch {
                    // Skip unreadable external subtitle file
                  }
                }
              }
            } else {
              info.subtitle_tracks.forEach((s, i) => {
                rebuiltSubs.push({
                  id: `int_s_${s.subtitle_index}`,
                  source_kind: 'internal',
                  subtitle_index: s.subtitle_index,
                  mpv_sid: s.mpv_sid,
                  codec_name: s.codec_name,
                  codec_long_name: s.codec_long_name,
                  language: s.language || '',
                  title: s.title || `字幕 ${i + 1}`,
                  enabled: true,
                  is_default: s.is_default,
                  delay_sec: 0,
                });
              });
            }

            const validAid = rebuiltAudio.some((a) => a.mpv_aid === st.active_audio_aid)
              ? st.active_audio_aid
              : rebuiltAudio[0]?.mpv_aid ?? 1;
            const validSid =
              st.active_subtitle_sid === 0
                ? 0
                : rebuiltSubs.some((s) => s.mpv_sid === st.active_subtitle_sid)
                ? st.active_subtitle_sid
                : 0;

            const clampedTime = Math.max(
              0,
              Math.min(info.duration || 0, st.playback_time || 0)
            );

            hydratedTabs.push({
              ...baseTab,
              media: info,
              isAnalyzing: false,
              playerError: null,
              playerState: {
                ...INITIAL_PLAYER_STATE,
                time_pos: clampedTime,
                duration: info.duration,
                paused: true,
                volume: typeof st.volume === 'number' ? st.volume : 100,
                speed: typeof st.speed === 'number' ? st.speed : 1,
                hdr_passthrough: st.hdr_passthrough !== false,
                aid: validAid,
                sid: validSid,
              },
              ranges: Array.isArray(st.ranges)
                ? st.ranges.map((r, ri) => ({
                    id: r.id || `cut_${Date.now()}_${tabIdx}_${ri}`,
                    start: r.start,
                    end: r.end,
                  }))
                : [],
              draftIn: typeof st.draft_in === 'number' ? st.draft_in : null,
              draftOut: typeof st.draft_out === 'number' ? st.draft_out : null,
              audioTracks: rebuiltAudio,
              mixedTracks: Array.isArray(st.mixed_tracks)
                ? st.mixed_tracks.map((m) => ({
                    ...m,
                    source_audio_indices: [...m.source_audio_indices],
                    gains_db: { ...m.gains_db },
                  }))
                : [],
              subtitleTracks: rebuiltSubs,
              outputDir: st.output_dir || getDirName(info.file_path),
            });
          } catch (err) {
            hydratedTabs.push({
              ...baseTab,
              playerError: t('msg.analyzeFail', { err: String(err) }),
            });
          }
        }

        const finalTabs = hydratedTabs.length > 0 ? hydratedTabs : [createEmptyTab()];
        const targetIdx = Math.max(
          0,
          Math.min(project.active_tab_index || 0, finalTabs.length - 1)
        );
        const nextActive = finalTabs[targetIdx];

        // Allow undoing back to prior workspace if user opened a project by mistake
        recordHistory();

        setTabs(finalTabs);
        setActiveTabId(nextActive.id);
        activeTabIdRef.current = nextActive.id;
        setCurrentProjectPath(projectFilePath);

        await syncPlayerToTab(nextActive);

        setExportProgress({
          status: 'done',
          percent: 100,
          out_time_sec: 0,
          expected_duration_sec: 0,
          speed: '',
          written_bytes: 0,
          message: t('proj.loadedToast', { name: project.name, n: finalTabs.length }),
          output_path: projectFilePath,
        });
      } catch (err) {
        setExportProgress({
          status: 'error',
          percent: 0,
          out_time_sec: 0,
          expected_duration_sec: 0,
          speed: '',
          written_bytes: 0,
          message: t('proj.loadFail', { err: String(err) }),
          output_path: projectFilePath,
        });
      } finally {
        setIsLoadingProject(false);
      }
    },
    [handleSkimEnd, recordHistory, syncPlayerToTab, t]
  );

  const handleOpenProjectPath = useCallback(
    async (filePath: string) => {
      if (isExportingRef.current || isLoadingProjectRef.current) return;

      try {
        const raw = await invoke<string>('load_project', { filePath });
        const project = parseProjectFile(raw);
        const refs = collectProjectMediaRefs(project);
        const existsList =
          refs.length > 0
            ? await invoke<boolean[]>('check_files_exist', {
                paths: refs.map((r) => r.originalPath),
              })
            : [];

        const missing: MissingMediaItem[] = [];
        refs.forEach((ref, i) => {
          if (!existsList[i]) {
            missing.push({
              key: ref.key,
              tabIndex: ref.tabIndex,
              tabLabel: ref.tabLabel,
              kind: ref.kind,
              trackIndex: ref.trackIndex,
              originalPath: ref.originalPath,
              fileName: ref.fileName,
              relinkedPath: null,
              skipped: false,
            });
          }
        });

        if (missing.length > 0) {
          setShowDetails(false);
          setPendingProject(project);
          setPendingProjectPath(filePath);
          setMissingMediaItems(missing);
        } else {
          await hydrateAndLoadProject(project, filePath);
        }
      } catch (err) {
        setExportProgress({
          status: 'error',
          percent: 0,
          out_time_sec: 0,
          expected_duration_sec: 0,
          speed: '',
          written_bytes: 0,
          message: t('proj.loadFail', { err: String(err) }),
          output_path: filePath,
        });
      }
    },
    [hydrateAndLoadProject, t]
  );

  const handleOpenProject = useCallback(async () => {
    if (isExportingRef.current || isLoadingProjectRef.current) return;
    const selected = await open({
      multiple: false,
      title: t('proj.openDialogTitle'),
      filters: [{ name: t('proj.fileFilterName'), extensions: ['hdrcut'] }],
    });
    if (typeof selected === 'string') {
      await handleOpenProjectPath(selected);
    }
  }, [handleOpenProjectPath, t]);

  const handleLocateMissingMedia = useCallback(
    async (key: string) => {
      const target = missingMediaItems.find((m) => m.key === key);
      if (!target) return;

      const filters =
        target.kind === 'video'
          ? [
              {
                name: t('dlg.videoFiles'),
                extensions: ['mkv', 'mp4', 'mov', 'm4v', 'ts', 'm2ts', 'webm', 'avi', 'flv'],
              },
            ]
          : target.kind === 'audio'
          ? [
              {
                name: t('dlg.audioFiles'),
                extensions: [
                  'flac',
                  'wav',
                  'aac',
                  'm4a',
                  'mp3',
                  'opus',
                  'ogg',
                  'ac3',
                  'eac3',
                  'dts',
                  'mka',
                ],
              },
            ]
          : [
              {
                name: t('dlg.subtitleFiles'),
                extensions: ['srt', 'ass', 'ssa', 'vtt', 'sup', 'sub'],
              },
            ];

      const kindText =
        target.kind === 'video'
          ? t('relink.kindVideo')
          : target.kind === 'audio'
          ? t('relink.kindAudio')
          : t('relink.kindSubtitle');

      const chosen = await open({
        multiple: false,
        title: t('relink.pickTitle', { kind: kindText, name: target.fileName }),
        filters,
      });
      if (typeof chosen !== 'string') return;

      // Smart same-folder auto-relink for all other still-missing items
      const chosenDir = getDirName(chosen);
      const autoFound = new Map<string, string>();
      if (chosenDir) {
        for (const item of missingMediaItems) {
          if (item.key === key || item.relinkedPath) continue;
          try {
            const match = await invoke<string | null>('find_file_in_dir', {
              dirPath: chosenDir,
              fileName: item.fileName,
            });
            if (match) autoFound.set(item.key, match);
          } catch {
            // ignore folder search errors
          }
        }
      }

      setMissingMediaItems((prev) =>
        prev.map((item) => {
          if (item.key === key) {
            return { ...item, relinkedPath: chosen, skipped: false };
          }
          const matched = autoFound.get(item.key);
          if (matched) {
            return { ...item, relinkedPath: matched, skipped: false };
          }
          return item;
        })
      );
    },
    [missingMediaItems, t]
  );

  const handleToggleSkipMissingMedia = useCallback((key: string) => {
    setMissingMediaItems((prev) =>
      prev.map((item) => (item.key === key ? { ...item, skipped: !item.skipped } : item))
    );
  }, []);

  const handleCancelMissingMedia = useCallback(() => {
    setPendingProject(null);
    setPendingProjectPath(null);
    setMissingMediaItems([]);
  }, []);

  const handleConfirmMissingMedia = useCallback(async () => {
    if (!pendingProject || !pendingProjectPath) return;
    const resolved = applyRelinkDecisions(pendingProject, missingMediaItems);
    const projPath = pendingProjectPath;
    setPendingProject(null);
    setPendingProjectPath(null);
    setMissingMediaItems([]);
    await hydrateAndLoadProject(resolved, projPath);
  }, [pendingProject, pendingProjectPath, missingMediaItems, hydrateAndLoadProject]);

  // Tab Actions: Select, Step, New, Close
  const handleSelectTab = useCallback(
    async (targetId: string) => {
      if (isExportingRef.current) return;
      if (targetId === activeTabIdRef.current) return;
      const target = tabsRef.current.find((t) => t.id === targetId);
      if (!target) return;
      handleSkimEnd(false);

      // Pause outgoing tab cleanly
      updateActiveTab((prev) => ({
        ...prev,
        playerState: { ...prev.playerState, paused: true },
      }));
      setShowDetails(false);
      setActiveTabId(targetId);
      activeTabIdRef.current = targetId;

      await syncPlayerToTab(target);
    },
    [handleSkimEnd, updateActiveTab, syncPlayerToTab]
  );

  const handleSelectTabByIndex = useCallback(
    (index: number) => {
      if (isExportingRef.current) return;
      const list = tabsRef.current;
      if (list.length === 0) return;
      if (index >= 0 && index < list.length) {
        void handleSelectTab(list[index].id);
      } else if (index === 8) {
        // Standard Cmd+9 behavior: jump to the last tab
        void handleSelectTab(list[list.length - 1].id);
      }
    },
    [handleSelectTab]
  );

  const handleStepTab = useCallback(
    (delta: number) => {
      if (isExportingRef.current) return;
      const list = tabsRef.current;
      if (list.length <= 1) return;
      const curIdx = list.findIndex((t) => t.id === activeTabIdRef.current);
      const baseIdx = curIdx >= 0 ? curIdx : 0;
      const nextIdx = (baseIdx + delta + list.length) % list.length;
      void handleSelectTab(list[nextIdx].id);
    },
    [handleSelectTab]
  );

  const handleNewTab = useCallback(async () => {
    if (isExportingRef.current || isLoadingProjectRef.current) return;
    handleSkimEnd(false);
    recordHistory();
    const currentDir = tabsRef.current.find((t) => t.id === activeTabIdRef.current)?.outputDir || '';
    const fresh = createEmptyTab(currentDir);
    updateActiveTab((prev) => ({
      ...prev,
      playerState: { ...prev.playerState, paused: true },
    }));
    setShowDetails(false);
    setTabs((prev) => [...prev, fresh]);
    setActiveTabId(fresh.id);
    activeTabIdRef.current = fresh.id;
    switchGuardUntilRef.current = performance.now() + 350;
    await invoke('player_stop').catch(() => {});
  }, [handleSkimEnd, recordHistory, updateActiveTab]);

  const handleCloseTab = useCallback(
    async (targetId: string) => {
      if (isExportingRef.current || isLoadingProjectRef.current) return;
      handleSkimEnd(false);
      const list = tabsRef.current;
      const idx = list.findIndex((t) => t.id === targetId);
      if (idx === -1) return;
      if (list.length === 1 && !list[0].media && list[0].ranges.length === 0) return;

      recordHistory();

      if (list.length === 1) {
        // Closing the last tab resets it to a clean empty tab (keeps app open)
        const dir = list[0].outputDir;
        const fresh = createEmptyTab(dir);
        setShowDetails(false);
        setTabs([fresh]);
        setActiveTabId(fresh.id);
        activeTabIdRef.current = fresh.id;
        switchGuardUntilRef.current = performance.now() + 350;
        await invoke('player_stop').catch(() => {});
        return;
      }

      const nextList = list.filter((t) => t.id !== targetId);
      const wasActive = targetId === activeTabIdRef.current;
      setTabs(nextList);

      if (wasActive) {
        const nextActive = nextList[Math.min(idx, nextList.length - 1)];
        setShowDetails(false);
        setActiveTabId(nextActive.id);
        activeTabIdRef.current = nextActive.id;
        await syncPlayerToTab(nextActive);
      }
    },
    [handleSkimEnd, recordHistory, syncPlayerToTab]
  );

  // Load video into the currently active tab
  const handleLoadVideoPath = useCallback(
    async (filePath: string) => {
      const targetTabId = activeTabIdRef.current;
      if (!targetTabId) return;
      handleSkimEnd(false);

      updateTab(targetTabId, (prev) => ({
        ...prev,
        isAnalyzing: true,
        playerError: null,
      }));
      setExportProgress(null);
      setShowDetails(false);

      try {
        const info = await invoke<MediaInfo>('analyze_media', { filePath });

        const editableAudio: EditableAudioTrack[] = info.audio_tracks.map((t, i) => ({
          id: `int_a_${t.audio_index}`,
          source_kind: 'internal',
          audio_index: t.audio_index,
          mpv_aid: t.mpv_aid,
          codec_name: t.codec_name,
          channel_layout: t.channel_layout,
          sample_rate: t.sample_rate,
          bit_rate: t.bit_rate,
          language: t.language || '',
          title: t.title || `音轨 ${i + 1}`,
          original_title: t.title || '',
          enabled: true,
          is_default: t.is_default || i === 0,
        }));

        const editableSubs: EditableSubtitleTrack[] = info.subtitle_tracks.map((s, i) => ({
          id: `int_s_${s.subtitle_index}`,
          source_kind: 'internal',
          subtitle_index: s.subtitle_index,
          mpv_sid: s.mpv_sid,
          codec_name: s.codec_name,
          codec_long_name: s.codec_long_name,
          language: s.language || '',
          title: s.title || `字幕 ${i + 1}`,
          enabled: true,
          is_default: s.is_default,
          delay_sec: 0,
        }));

        recordHistory();

        updateTab(targetTabId, (prev) => ({
          ...prev,
          media: info,
          isAnalyzing: false,
          playerError: null,
          playerState: {
            ...INITIAL_PLAYER_STATE,
            duration: info.duration,
            paused: true,
            sid: editableSubs.length > 0 ? editableSubs[0].mpv_sid : 0,
          },
          ranges: [],
          draftIn: null,
          draftOut: null,
          audioTracks: editableAudio,
          mixedTracks: [],
          subtitleTracks: editableSubs,
          outputDir: prev.outputDir || getDirName(info.file_path),
        }));

        // Only drive the player if this tab is still the active tab
        if (activeTabIdRef.current === targetTabId) {
          try {
            switchGuardUntilRef.current = performance.now() + 250;
            await invoke<string>('player_init');
            setIsNativeReady(true);
            await invoke('player_load', {
              filePath: info.file_path,
              hdrFormat: info.video?.hdr_format ?? null,
              startTime: null,
              startPaused: true,
            });
          } catch (err) {
            updateTab(targetTabId, (prev) => ({
              ...prev,
              playerError: t('msg.playerInitFail', { err: String(err) }),
            }));
          }
        }
      } catch (err) {
        updateTab(targetTabId, (prev) => ({
          ...prev,
          isAnalyzing: false,
          playerError: t('msg.analyzeFail', { err: String(err) }),
        }));
      }
    },
    [handleSkimEnd, recordHistory, t, updateTab]
  );

  const handleCloseVideoInTab = useCallback(async () => {
    const cur = tabsRef.current.find((tb) => tb.id === activeTabIdRef.current);
    if (!cur?.media) return;
    handleSkimEnd(false);
    recordHistory();
    try {
      await invoke('player_stop');
    } catch {
      // ignore
    }
    setShowDetails(false);
    updateActiveTab((prev) => ({
      ...createEmptyTab(prev.outputDir),
      id: prev.id,
      exportFormat: prev.exportFormat,
    }));
  }, [handleSkimEnd, recordHistory, updateActiveTab]);

  const handleImportVideo = useCallback(async () => {
    const selected = await open({
      multiple: false,
      title: t('dlg.selectVideo'),
      filters: [
        {
          name: t('dlg.videoFiles'),
          extensions: ['mkv', 'mp4', 'mov', 'm4v', 'ts', 'm2ts', 'webm', 'avi', 'flv'],
        },
      ],
    });
    if (typeof selected === 'string') {
      await handleLoadVideoPath(selected);
    }
  }, [handleLoadVideoPath, t]);

  // Subscribe to native Tauri events (mpv-state, export-progress, menu shortcuts, file drop)
  const handleCloseTabRef = useRef(handleCloseTab);
  handleCloseTabRef.current = handleCloseTab;
  const handleNewTabRef = useRef(handleNewTab);
  handleNewTabRef.current = handleNewTab;
  const handleSelectTabByIndexRef = useRef(handleSelectTabByIndex);
  handleSelectTabByIndexRef.current = handleSelectTabByIndex;
  const handleStepTabRef = useRef(handleStepTab);
  handleStepTabRef.current = handleStepTab;
  const handleImportVideoRef = useRef(handleImportVideo);
  handleImportVideoRef.current = handleImportVideo;
  const handleLoadVideoPathRef = useRef(handleLoadVideoPath);
  handleLoadVideoPathRef.current = handleLoadVideoPath;
  const handleUndoRef = useRef(handleUndo);
  handleUndoRef.current = handleUndo;
  const handleRedoRef = useRef(handleRedo);
  handleRedoRef.current = handleRedo;
  const handleSaveProjectRef = useRef(handleSaveProject);
  handleSaveProjectRef.current = handleSaveProject;
  const handleOpenProjectRef = useRef(handleOpenProject);
  handleOpenProjectRef.current = handleOpenProject;
  const handleOpenProjectPathRef = useRef(handleOpenProjectPath);
  handleOpenProjectPathRef.current = handleOpenProjectPath;

  useEffect(() => {
    invoke<ToolStatus>('get_tool_status')
      .then(setToolStatus)
      .catch(() => {});

    let unlistenState: (() => void) | undefined;
    let unlistenExport: (() => void) | undefined;
    let unlistenDrop: (() => void) | undefined;
    let unlistenCloseTab: (() => void) | undefined;
    let unlistenNewTab: (() => void) | undefined;
    let unlistenOpenVideo: (() => void) | undefined;
    let unlistenSelectTab: (() => void) | undefined;
    let unlistenStepTab: (() => void) | undefined;
    let unlistenUpdateProgress: (() => void) | undefined;
    let unlistenUndo: (() => void) | undefined;
    let unlistenRedo: (() => void) | undefined;
    let unlistenSaveProject: (() => void) | undefined;
    let unlistenSaveProjectAs: (() => void) | undefined;
    let unlistenOpenProject: (() => void) | undefined;

    listen<PlayerStateEvent>('mpv-state', (ev) => {
      if (performance.now() < switchGuardUntilRef.current) return;
      if (skimRef.current.active) return;
      const curId = activeTabIdRef.current;
      if (!curId) return;
      setTabs((prev) =>
        prev.map((t) =>
          t.id === curId && t.media ? { ...t, playerState: ev.payload } : t
        )
      );
    }).then((fn) => {
      unlistenState = fn;
    });

    listen<ExportProgressEvent>('export-progress', (ev) => {
      setExportProgress(ev.payload);
    }).then((fn) => {
      unlistenExport = fn;
    });

    listen('shortcut-close-tab', () => {
      handleCloseTabRef.current(activeTabIdRef.current);
    }).then((fn) => {
      unlistenCloseTab = fn;
    });

    listen('shortcut-new-tab', () => {
      handleNewTabRef.current();
    }).then((fn) => {
      unlistenNewTab = fn;
    });

    listen('shortcut-open-video', () => {
      handleImportVideoRef.current();
    }).then((fn) => {
      unlistenOpenVideo = fn;
    });

    listen<number>('shortcut-select-tab', (ev) => {
      handleSelectTabByIndexRef.current(ev.payload);
    }).then((fn) => {
      unlistenSelectTab = fn;
    });

    listen<number>('shortcut-step-tab', (ev) => {
      handleStepTabRef.current(ev.payload);
    }).then((fn) => {
      unlistenStepTab = fn;
    });

    listen('shortcut-undo', () => {
      const activeEl = document.activeElement as HTMLElement | null;
      if (activeEl?.tagName === 'TEXTAREA') {
        document.execCommand('undo');
        return;
      }
      const now = performance.now();
      if (now - lastUndoRedoAtRef.current < 40) return;
      lastUndoRedoAtRef.current = now;
      handleUndoRef.current();
    }).then((fn) => {
      unlistenUndo = fn;
    });

    listen('shortcut-redo', () => {
      const activeEl = document.activeElement as HTMLElement | null;
      if (activeEl?.tagName === 'TEXTAREA') {
        document.execCommand('redo');
        return;
      }
      const now = performance.now();
      if (now - lastUndoRedoAtRef.current < 40) return;
      lastUndoRedoAtRef.current = now;
      handleRedoRef.current();
    }).then((fn) => {
      unlistenRedo = fn;
    });

    listen('shortcut-save-project', () => {
      handleSaveProjectRef.current(false);
    }).then((fn) => {
      unlistenSaveProject = fn;
    });

    listen('shortcut-save-project-as', () => {
      handleSaveProjectRef.current(true);
    }).then((fn) => {
      unlistenSaveProjectAs = fn;
    });

    listen('shortcut-open-project', () => {
      handleOpenProjectRef.current();
    }).then((fn) => {
      unlistenOpenProject = fn;
    });

    listen<UpdateProgressEvent>('update-progress', (ev) => {
      if (ev.payload.stage === 'cancelled') {
        setUpdateProgress(null);
      } else {
        setUpdateProgress(ev.payload);
      }
    }).then((fn) => {
      unlistenUpdateProgress = fn;
    });

    getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type === 'drop' && event.payload.paths.length > 0) {
          const dropped = event.payload.paths[0];
          if (/\.hdrcut$/i.test(dropped)) {
            handleOpenProjectPathRef.current(dropped);
          } else {
            handleLoadVideoPathRef.current(dropped);
          }
        }
      })
      .then((fn) => {
        unlistenDrop = fn;
      })
      .catch(() => {});

    return () => {
      unlistenState?.();
      unlistenExport?.();
      unlistenDrop?.();
      unlistenCloseTab?.();
      unlistenNewTab?.();
      unlistenOpenVideo?.();
      unlistenSelectTab?.();
      unlistenStepTab?.();
      unlistenUpdateProgress?.();
      unlistenUndo?.();
      unlistenRedo?.();
      unlistenSaveProject?.();
      unlistenSaveProjectAs?.();
      unlistenOpenProject?.();
    };
  }, []);

  // Derived active tab variables
  const media = activeTab.media;
  const playerState = activeTab.playerState;
  const duration = media?.duration || playerState.duration || 0;
  const keyframes = media?.keyframes || [];
  const snapKeyframes = !activeTab.smartCut;

  const { segments: keptSegments, isFullFile } = useMemo(
    () =>
      computeKeptSegments(
        activeTab.ranges,
        activeTab.cutMode,
        duration,
        keyframes,
        snapKeyframes
      ),
    [activeTab.ranges, activeTab.cutMode, duration, keyframes, snapKeyframes]
  );

  const handlePickOutputDir = useCallback(async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: t('dlg.selectOutputDir'),
      defaultPath: activeTab.outputDir || undefined,
    });
    if (typeof selected === 'string') {
      recordHistory();
      updateActiveTab((prev) => ({ ...prev, outputDir: selected }));
    }
  }, [activeTab.outputDir, recordHistory, t, updateActiveTab]);

  // Playback Controls
  const handleTogglePause = useCallback(() => {
    if (!media) return;
    if (skimRef.current.active) {
      handleSkimEnd(true);
    }
    invoke('player_toggle_pause').catch(() => {});
  }, [media, handleSkimEnd]);

  const handleSeek = useCallback(
    (seconds: number, exact: boolean) => {
      if (!media) return;
      const clamped = Math.max(0, Math.min(duration || seconds, seconds));
      updateActiveTab((prev) => ({
        ...prev,
        playerState: { ...prev.playerState, time_pos: clamped },
      }));
      invoke('player_seek', { seconds: clamped, exact }).catch(() => {});
    },
    [media, duration, updateActiveTab]
  );

  const handleSkimMove = useCallback(
    (seconds: number) => {
      if (!skimmingEnabled || !media || showDetails || isExportingRef.current) return;
      const clamped = Math.max(0, Math.min(duration || seconds, seconds));
      if (!skimRef.current.active) {
        const curTab = tabsRef.current.find((t) => t.id === activeTabIdRef.current);
        skimRef.current.active = true;
        skimRef.current.anchorTime = curTab?.playerState.time_pos ?? 0;
        skimRef.current.wasPlaying = curTab ? !curTab.playerState.paused : false;
        if (skimRef.current.wasPlaying) {
          invoke('player_set_pause', { paused: true }).catch(() => {});
        }
      }
      skimRef.current.currentSkimTime = clamped;

      const now = performance.now();
      if (now - skimRef.current.lastSeekAt >= 40) {
        skimRef.current.lastSeekAt = now;
        invoke('player_seek', { seconds: clamped, exact: false }).catch(() => {});
      }

      // Refine to exact frame shortly after cursor slows or stops
      clearSkimTimer();
      skimRef.current.exactTimer = window.setTimeout(() => {
        skimRef.current.exactTimer = null;
        if (skimRef.current.active) {
          invoke('player_seek', {
            seconds: skimRef.current.currentSkimTime,
            exact: true,
          }).catch(() => {});
        }
      }, 95);
    },
    [skimmingEnabled, media, showDetails, duration, clearSkimTimer]
  );

  const handleSkimCommit = useCallback(
    (seconds: number) => {
      clearSkimTimer();
      const wasPlaying = skimRef.current.active && skimRef.current.wasPlaying;
      skimRef.current.active = false;
      const clamped = Math.max(0, Math.min(duration || seconds, seconds));
      updateActiveTab((prev) => ({
        ...prev,
        playerState: {
          ...prev.playerState,
          time_pos: clamped,
          paused: wasPlaying ? true : prev.playerState.paused,
        },
      }));
      invoke('player_seek', { seconds: clamped, exact: true }).catch(() => {});
    },
    [clearSkimTimer, duration, updateActiveTab]
  );

  const handleSeekRelative = useCallback(
    (delta: number) => {
      if (!media) return;
      invoke('player_seek_relative', { delta }).catch(() => {});
    },
    [media]
  );

  const handleStepFrame = useCallback(
    (forward: boolean) => {
      if (!media) return;
      invoke('player_frame_step', { forward }).catch(() => {});
    },
    [media]
  );

  const handleStepKeyframe = useCallback(
    async (direction: 'prev' | 'next') => {
      if (!media) return;
      let kfs = keyframes;
      if (kfs.length === 0) {
        try {
          kfs = await invoke<number[]>('get_keyframes_near', {
            filePath: media.file_path,
            targetTime: playerState.time_pos,
            windowSec: 20,
          });
        } catch {
          kfs = [];
        }
      }
      const nextTime = stepKeyframe(playerState.time_pos, kfs, direction, duration);
      handleSeek(nextTime, true);
    },
    [media, keyframes, playerState.time_pos, duration, handleSeek]
  );

  const handleSetVolume = useCallback(
    (volume: number) => {
      updateActiveTab((prev) => ({
        ...prev,
        playerState: { ...prev.playerState, volume },
      }));
      invoke('player_set_volume', { volume }).catch(() => {});
    },
    [updateActiveTab]
  );

  const handleSetSpeed = useCallback(
    (speed: number) => {
      updateActiveTab((prev) => ({
        ...prev,
        playerState: { ...prev.playerState, speed },
      }));
      invoke('player_set_speed', { speed }).catch(() => {});
    },
    [updateActiveTab]
  );

  const handleToggleHdr = useCallback(() => {
    const next = !playerState.hdr_passthrough;
    updateActiveTab((prev) => ({
      ...prev,
      playerState: { ...prev.playerState, hdr_passthrough: next },
    }));
    invoke('player_set_hdr', { enabled: next }).catch(() => {});
  }, [playerState.hdr_passthrough, updateActiveTab]);

  const handleSelectPreviewAudio = useCallback(
    (aid: number) => {
      updateActiveTab((prev) => ({
        ...prev,
        playerState: { ...prev.playerState, aid },
      }));
      invoke('player_set_audio_track', { aid }).catch(() => {});
    },
    [updateActiveTab]
  );

  const handleSelectPreviewSubtitle = useCallback(
    (sid: number) => {
      updateActiveTab((prev) => ({
        ...prev,
        playerState: { ...prev.playerState, sid },
      }));
      invoke('player_set_subtitle_track', { sid }).catch(() => {});
      const targetSub = activeTab.subtitleTracks.find((s) => s.mpv_sid === sid);
      invoke('player_set_sub_delay', { seconds: targetSub?.delay_sec ?? 0 }).catch(() => {});
    },
    [activeTab.subtitleTracks, updateActiveTab]
  );

  // Cut Range Operations
  const handleAddRange = useCallback(
    (start: number, end: number) => {
      if (end <= start + 0.05) return;
      recordHistory();
      updateActiveTab((prev) => ({
        ...prev,
        ranges: [
          ...prev.ranges,
          { id: `cut_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, start, end },
        ],
      }));
    },
    [recordHistory, updateActiveTab]
  );

  const handleAddBatchRanges = useCallback(
    (items: Array<{ start: number; end: number }>, replace: boolean) => {
      if (items.length === 0 && !replace) return;
      recordHistory();
      const nextItems: CutRange[] = items.map((r, i) => ({
        id: `batch_${Date.now()}_${i}`,
        start: r.start,
        end: r.end,
      }));
      updateActiveTab((prev) => ({
        ...prev,
        ranges: replace ? nextItems : [...prev.ranges, ...nextItems],
      }));
    },
    [recordHistory, updateActiveTab]
  );

  const handleUpdateRange = useCallback(
    (id: string, start: number, end: number) => {
      recordHistory(`range-edit-${id}`);
      updateActiveTab((prev) => ({
        ...prev,
        ranges: prev.ranges.map((r) => (r.id === id ? { ...r, start, end } : r)),
      }));
    },
    [recordHistory, updateActiveTab]
  );

  const handleDeleteRange = useCallback(
    (id: string) => {
      recordHistory();
      updateActiveTab((prev) => ({
        ...prev,
        ranges: prev.ranges.filter((r) => r.id !== id),
      }));
    },
    [recordHistory, updateActiveTab]
  );

  const handleMarkIn = useCallback(() => {
    if (!media) return;
    const baseTime = skimRef.current.active
      ? skimRef.current.currentSkimTime
      : playerState.time_pos;
    const t = snapKeyframes ? snapToNearestKeyframe(baseTime, keyframes, duration) : baseTime;
    recordHistory();
    updateActiveTab((prev) => ({
      ...prev,
      draftIn: t,
      draftOut: prev.draftOut !== null && prev.draftOut <= t ? null : prev.draftOut,
    }));
  }, [media, snapKeyframes, playerState.time_pos, keyframes, duration, recordHistory, updateActiveTab]);

  const handleMarkOut = useCallback(() => {
    if (!media) return;
    const baseTime = skimRef.current.active
      ? skimRef.current.currentSkimTime
      : playerState.time_pos;
    const t = snapKeyframes ? snapToNearestKeyframe(baseTime, keyframes, duration) : baseTime;
    recordHistory();
    if (activeTab.draftIn !== null && t > activeTab.draftIn + 0.05) {
      const start = activeTab.draftIn;
      updateActiveTab((prev) => ({
        ...prev,
        ranges: [
          ...prev.ranges,
          { id: `cut_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, start, end: t },
        ],
        draftIn: null,
        draftOut: null,
      }));
    } else {
      updateActiveTab((prev) => ({ ...prev, draftOut: t }));
    }
  }, [
    media,
    snapKeyframes,
    playerState.time_pos,
    keyframes,
    duration,
    activeTab.draftIn,
    recordHistory,
    updateActiveTab,
  ]);

  const handleCommitDraftRange = useCallback(() => {
    if (
      activeTab.draftIn !== null &&
      activeTab.draftOut !== null &&
      activeTab.draftOut > activeTab.draftIn + 0.05
    ) {
      const start = activeTab.draftIn;
      const end = activeTab.draftOut;
      recordHistory();
      updateActiveTab((prev) => ({
        ...prev,
        ranges: [
          ...prev.ranges,
          { id: `cut_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, start, end },
        ],
        draftIn: null,
        draftOut: null,
      }));
    }
  }, [activeTab.draftIn, activeTab.draftOut, recordHistory, updateActiveTab]);

  // Audio Track Operations
  const handleUpdateAudioTrack = useCallback(
    (id: string, patch: Partial<EditableAudioTrack>) => {
      recordHistory(patch.enabled !== undefined ? undefined : `audio-edit-${id}`);
      updateActiveTab((prev) => ({
        ...prev,
        audioTracks: prev.audioTracks.map((t) => (t.id === id ? { ...t, ...patch } : t)),
      }));
    },
    [recordHistory, updateActiveTab]
  );

  const handleMoveAudioTrack = useCallback(
    (index: number, direction: -1 | 1) => {
      const target = index + direction;
      if (target < 0 || target >= activeTab.audioTracks.length) return;
      recordHistory();
      updateActiveTab((prev) => {
        if (target < 0 || target >= prev.audioTracks.length) return prev;
        const copy = [...prev.audioTracks];
        const [item] = copy.splice(index, 1);
        copy.splice(target, 0, item);
        return { ...prev, audioTracks: copy };
      });
    },
    [activeTab.audioTracks.length, recordHistory, updateActiveTab]
  );

  const handleToggleAllAudioTracks = useCallback(
    (enabled: boolean) => {
      if (activeTab.audioTracks.length === 0) return;
      recordHistory();
      updateActiveTab((prev) => ({
        ...prev,
        audioTracks: prev.audioTracks.map((tr) => ({ ...tr, enabled })),
      }));
    },
    [activeTab.audioTracks.length, recordHistory, updateActiveTab]
  );

  const handleDeleteAudioTrack = useCallback(
    (id: string) => {
      const target = activeTab.audioTracks.find((tr) => tr.id === id);
      if (!target) return;
      recordHistory();
      const remaining = activeTab.audioTracks.filter((tr) => tr.id !== id);
      const removedInternalIdx =
        target.source_kind === 'internal' ? target.audio_index : null;
      updateActiveTab((prev) => ({
        ...prev,
        audioTracks: prev.audioTracks.filter((tr) => tr.id !== id),
        mixedTracks:
          removedInternalIdx === null
            ? prev.mixedTracks
            : prev.mixedTracks.filter(
                (m) => !m.source_audio_indices.includes(removedInternalIdx)
              ),
      }));
      if (target.source_kind === 'external' && target.mpv_aid > 0) {
        invoke('player_remove_audio_track', { aid: target.mpv_aid }).catch(() => {});
      }
      if (target.mpv_aid === playerState.aid && remaining.length > 0) {
        handleSelectPreviewAudio(remaining[0].mpv_aid);
      }
    },
    [activeTab.audioTracks, playerState.aid, recordHistory, updateActiveTab, handleSelectPreviewAudio]
  );

  const handleDeleteCheckedAudioTracks = useCallback(() => {
    const toRemove = activeTab.audioTracks.filter((tr) => tr.enabled);
    if (toRemove.length === 0) return;
    recordHistory();
    const removedIds = new Set(toRemove.map((tr) => tr.id));
    const removedInternalIndices = new Set(
      toRemove.filter((tr) => tr.source_kind === 'internal').map((tr) => tr.audio_index)
    );
    const remaining = activeTab.audioTracks.filter((tr) => !removedIds.has(tr.id));
    updateActiveTab((prev) => ({
      ...prev,
      audioTracks: prev.audioTracks.filter((tr) => !removedIds.has(tr.id)),
      mixedTracks:
        removedInternalIndices.size === 0
          ? prev.mixedTracks
          : prev.mixedTracks.filter(
              (m) => !m.source_audio_indices.some((idx) => removedInternalIndices.has(idx))
            ),
    }));
    for (const tr of toRemove) {
      if (tr.source_kind === 'external' && tr.mpv_aid > 0) {
        invoke('player_remove_audio_track', { aid: tr.mpv_aid }).catch(() => {});
      }
    }
    if (toRemove.some((tr) => tr.mpv_aid === playerState.aid) && remaining.length > 0) {
      handleSelectPreviewAudio(remaining[0].mpv_aid);
    }
  }, [activeTab.audioTracks, playerState.aid, recordHistory, updateActiveTab, handleSelectPreviewAudio]);

  const handleSetDefaultAudioTrack = useCallback(
    (kind: 'original' | 'mixed', id: string) => {
      recordHistory();
      updateActiveTab((prev) => ({
        ...prev,
        audioTracks: prev.audioTracks.map((t) => ({
          ...t,
          is_default: kind === 'original' && t.id === id,
        })),
        mixedTracks: prev.mixedTracks.map((m) => ({
          ...m,
          is_default: kind === 'mixed' && m.id === id,
        })),
      }));
    },
    [recordHistory, updateActiveTab]
  );

  const handleImportAudioTrack = useCallback(async () => {
    if (!media) return;
    const selected = await open({
      multiple: false,
      title: t('dlg.importAudio'),
      filters: [
        {
          name: t('dlg.audioFiles'),
          extensions: ['flac', 'wav', 'aac', 'm4a', 'mp3', 'opus', 'ogg', 'ac3', 'eac3', 'dts', 'mka'],
        },
      ],
    });
    if (typeof selected !== 'string') return;

    try {
      const info = await invoke<ExternalAudioInfo>('probe_external_audio_file', {
        filePath: selected,
      });
      const assignedAid = await invoke<number>('player_add_audio_file', {
        filePath: info.file_path,
      });
      const newTrack: EditableAudioTrack = {
        id: `ext_a_${Date.now()}`,
        source_kind: 'external',
        audio_index: -1,
        file_path: info.file_path,
        mpv_aid: assignedAid,
        codec_name: info.codec_name,
        channel_layout: info.channel_layout,
        sample_rate: info.sample_rate,
        bit_rate: info.bit_rate,
        language: info.language || '',
        title: info.title || getBaseNameWithoutExt(info.file_name),
        original_title: info.title || info.file_name,
        enabled: true,
        is_default: false,
      };
      recordHistory();
      updateActiveTab((prev) => ({
        ...prev,
        audioTracks: [...prev.audioTracks, newTrack],
        playerState: { ...prev.playerState, aid: assignedAid },
      }));
    } catch (err) {
      setExportProgress({
        status: 'error',
        percent: 0,
        out_time_sec: 0,
        expected_duration_sec: 0,
        speed: '',
        written_bytes: 0,
        message: t('msg.importAudioFail', { err: String(err) }),
        output_path: '',
      });
    }
  }, [media, activeTab.audioTracks, recordHistory, t, updateActiveTab]);

  const handleExportSingleAudio = useCallback(
    async (track: EditableAudioTrack) => {
      if (!media || track.source_kind !== 'internal') return;
      const ext = audioExtForCodec(track.codec_name);
      const base = getBaseNameWithoutExt(media.file_name);
      const label = sanitizeFilePart(track.title || `track${track.audio_index + 1}`);
      const defaultName = `${base}_${label}.${ext}`;
      const baseDir = activeTab.outputDir || getDirName(media.file_path);
      const chosen = await save({
        title: t('dlg.exportSingleAudio'),
        defaultPath: baseDir ? joinPath(baseDir, defaultName) : defaultName,
        filters: [{ name: `${track.codec_name.toUpperCase()}`, extensions: [ext] }],
      });
      if (!chosen) return;

      setIsExtracting(true);
      setExportProgress({
        status: 'running',
        percent: 35,
        out_time_sec: 0,
        expected_duration_sec: duration,
        speed: t('msg.extracting'),
        written_bytes: 0,
        message: t('msg.exportingAudio', { title: track.title }),
        output_path: chosen,
      });
      try {
        await invoke<string[]>('export_audio_tracks', {
          inputPath: media.file_path,
          items: [
            {
              audio_index: track.audio_index,
              output_path: chosen,
              codec_name: track.codec_name,
            },
          ],
        });
        setExportProgress({
          status: 'done',
          percent: 100,
          out_time_sec: duration,
          expected_duration_sec: duration,
          speed: '',
          written_bytes: 0,
          message: t('msg.exportedAudio', { title: track.title }),
          output_path: chosen,
        });
      } catch (err) {
        setExportProgress({
          status: 'error',
          percent: 0,
          out_time_sec: 0,
          expected_duration_sec: duration,
          speed: '',
          written_bytes: 0,
          message: String(err),
          output_path: chosen,
        });
      } finally {
        setIsExtracting(false);
      }
    },
    [media, activeTab.outputDir, duration, t]
  );

  const handleExportBatchAudio = useCallback(async () => {
    if (!media) return;
    const targets = activeTab.audioTracks.filter(
      (tr) => tr.enabled && tr.source_kind === 'internal'
    );
    if (targets.length === 0) return;

    const dir = await open({
      directory: true,
      multiple: false,
      title: t('dlg.exportBatchAudio', { n: targets.length }),
      defaultPath: activeTab.outputDir || getDirName(media.file_path) || undefined,
    });
    if (typeof dir !== 'string') return;

    const base = getBaseNameWithoutExt(media.file_name);
    const items = targets.map((tr) => {
      const ext = audioExtForCodec(tr.codec_name);
      const label = sanitizeFilePart(tr.title || `track${tr.audio_index + 1}`);
      return {
        audio_index: tr.audio_index,
        output_path: joinPath(dir, `${base}_audio${tr.audio_index + 1}_${label}.${ext}`),
        codec_name: tr.codec_name,
      };
    });

    setIsExtracting(true);
    setExportProgress({
      status: 'running',
      percent: 30,
      out_time_sec: 0,
      expected_duration_sec: duration,
      speed: t('msg.batchCount', { n: items.length }),
      written_bytes: 0,
      message: t('msg.exportingBatchAudio', { n: items.length }),
      output_path: items[0].output_path,
    });

    try {
      const outs = await invoke<string[]>('export_audio_tracks', {
        inputPath: media.file_path,
        items,
      });
      setExportProgress({
        status: 'done',
        percent: 100,
        out_time_sec: duration,
        expected_duration_sec: duration,
        speed: '',
        written_bytes: 0,
        message: t('msg.exportedBatchAudio', { n: outs.length }),
        output_path: outs[0] || dir,
      });
    } catch (err) {
      setExportProgress({
        status: 'error',
        percent: 0,
        out_time_sec: 0,
        expected_duration_sec: duration,
        speed: '',
        written_bytes: 0,
        message: String(err),
        output_path: dir,
      });
    } finally {
      setIsExtracting(false);
    }
  }, [media, activeTab.audioTracks, activeTab.outputDir, duration, t]);

  // Subtitle Operations (Preview, Delay Offset, Import, Single/Batch Export)
  const handleUpdateSubtitle = useCallback(
    (id: string, patch: Partial<EditableSubtitleTrack>) => {
      recordHistory(patch.enabled !== undefined ? undefined : `sub-edit-${id}`);
      updateActiveTab((prev) => ({
        ...prev,
        subtitleTracks: prev.subtitleTracks.map((s) => (s.id === id ? { ...s, ...patch } : s)),
      }));
    },
    [recordHistory, updateActiveTab]
  );

  const handleSetSubtitleDelay = useCallback(
    (id: string, delaySec: number) => {
      const clamped = Math.max(-3600, Math.min(3600, delaySec));
      const targetSub = activeTab.subtitleTracks.find((s) => s.id === id);
      recordHistory(`sub-delay-${id}`);
      updateActiveTab((prev) => ({
        ...prev,
        subtitleTracks: prev.subtitleTracks.map((s) =>
          s.id === id ? { ...s, delay_sec: clamped } : s
        ),
      }));
      // Apply immediately to live libmpv preview if this subtitle is currently shown!
      if (targetSub && targetSub.mpv_sid === playerState.sid) {
        invoke('player_set_sub_delay', { seconds: clamped }).catch(() => {});
      }
    },
    [activeTab.subtitleTracks, playerState.sid, recordHistory, updateActiveTab]
  );

  const handleBatchShiftSubtitles = useCallback(
    (deltaSec: number) => {
      const checked = activeTab.subtitleTracks.filter((s) => s.enabled);
      if (checked.length === 0) return;
      recordHistory('sub-batch-delay');
      let updatedActiveDelay: number | null = null;
      updateActiveTab((prev) => ({
        ...prev,
        subtitleTracks: prev.subtitleTracks.map((s) => {
          if (!s.enabled) return s;
          const next = Math.max(
            -3600,
            Math.min(3600, Math.round(((s.delay_sec || 0) + deltaSec) * 100) / 100)
          );
          if (s.mpv_sid === prev.playerState.sid) {
            updatedActiveDelay = next;
          }
          return { ...s, delay_sec: next };
        }),
      }));
      const previewed = checked.find((s) => s.mpv_sid === playerState.sid);
      if (previewed) {
        const nextVal =
          updatedActiveDelay ??
          Math.max(
            -3600,
            Math.min(3600, Math.round(((previewed.delay_sec || 0) + deltaSec) * 100) / 100)
          );
        invoke('player_set_sub_delay', { seconds: nextVal }).catch(() => {});
      }
    },
    [activeTab.subtitleTracks, playerState.sid, recordHistory, updateActiveTab]
  );

  const handleBatchSetSubtitlesDelay = useCallback(
    (delaySec: number) => {
      const checked = activeTab.subtitleTracks.filter((s) => s.enabled);
      if (checked.length === 0) return;
      const clamped = Math.max(-3600, Math.min(3600, Math.round(delaySec * 100) / 100));
      recordHistory();
      updateActiveTab((prev) => ({
        ...prev,
        subtitleTracks: prev.subtitleTracks.map((s) =>
          s.enabled ? { ...s, delay_sec: clamped } : s
        ),
      }));
      if (checked.some((s) => s.mpv_sid === playerState.sid)) {
        invoke('player_set_sub_delay', { seconds: clamped }).catch(() => {});
      }
    },
    [activeTab.subtitleTracks, playerState.sid, recordHistory, updateActiveTab]
  );

  const handleSetDefaultSubtitle = useCallback(
    (id: string) => {
      recordHistory();
      updateActiveTab((prev) => ({
        ...prev,
        subtitleTracks: prev.subtitleTracks.map((s) => ({ ...s, is_default: s.id === id })),
      }));
    },
    [recordHistory, updateActiveTab]
  );

  const handleToggleAllSubtitles = useCallback(
    (enabled: boolean) => {
      if (activeTab.subtitleTracks.length === 0) return;
      recordHistory();
      updateActiveTab((prev) => ({
        ...prev,
        subtitleTracks: prev.subtitleTracks.map((s) => ({ ...s, enabled })),
      }));
    },
    [activeTab.subtitleTracks.length, recordHistory, updateActiveTab]
  );

  const handleDeleteSubtitle = useCallback(
    (id: string) => {
      const target = activeTab.subtitleTracks.find((s) => s.id === id);
      if (!target) return;
      recordHistory();
      updateActiveTab((prev) => ({
        ...prev,
        subtitleTracks: prev.subtitleTracks.filter((s) => s.id !== id),
      }));
      if (target.source_kind === 'external' && target.mpv_sid > 0) {
        invoke('player_remove_subtitle_track', { sid: target.mpv_sid }).catch(() => {});
      }
      if (target.mpv_sid === playerState.sid) {
        handleSelectPreviewSubtitle(0);
      }
    },
    [activeTab.subtitleTracks, playerState.sid, recordHistory, updateActiveTab, handleSelectPreviewSubtitle]
  );

  const handleDeleteCheckedSubtitles = useCallback(() => {
    const toRemove = activeTab.subtitleTracks.filter((s) => s.enabled);
    if (toRemove.length === 0) return;
    recordHistory();
    const removedIds = new Set(toRemove.map((s) => s.id));
    updateActiveTab((prev) => ({
      ...prev,
      subtitleTracks: prev.subtitleTracks.filter((s) => !removedIds.has(s.id)),
    }));
    for (const s of toRemove) {
      if (s.source_kind === 'external' && s.mpv_sid > 0) {
        invoke('player_remove_subtitle_track', { sid: s.mpv_sid }).catch(() => {});
      }
    }
    if (toRemove.some((s) => s.mpv_sid === playerState.sid)) {
      handleSelectPreviewSubtitle(0);
    }
  }, [activeTab.subtitleTracks, playerState.sid, recordHistory, updateActiveTab, handleSelectPreviewSubtitle]);

  const handleImportSubtitle = useCallback(async () => {
    if (!media) return;
    const selected = await open({
      multiple: true,
      title: t('dlg.importSubtitle'),
      filters: [
        {
          name: t('dlg.subtitleFiles'),
          extensions: ['srt', 'ass', 'ssa', 'vtt', 'sup', 'sub'],
        },
      ],
    });
    const paths = (
      Array.isArray(selected) ? selected : typeof selected === 'string' ? [selected] : []
    ).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
    if (paths.length === 0) return;

    const added: EditableSubtitleTrack[] = [];

    for (let i = 0; i < paths.length; i++) {
      const p = paths[i];
      try {
        const info = await invoke<ExternalSubtitleInfo>('probe_external_subtitle_file', {
          filePath: p,
        });
        const assignedSid = await invoke<number>('player_add_subtitle_file', {
          filePath: info.file_path,
        });
        added.push({
          id: `ext_s_${Date.now()}_${i}_${assignedSid}`,
          source_kind: 'external',
          file_path: info.file_path,
          mpv_sid: assignedSid,
          codec_name: info.codec_name,
          codec_long_name: info.codec_name.toUpperCase(),
          language: info.language || '',
          title: info.title,
          enabled: true,
          is_default: false,
          delay_sec: 0,
        });
      } catch (err) {
        setExportProgress({
          status: 'error',
          percent: 0,
          out_time_sec: 0,
          expected_duration_sec: 0,
          speed: '',
          written_bytes: 0,
          message: t('msg.importSubFail', { err: String(err) }),
          output_path: '',
        });
      }
    }

    if (added.length > 0) {
      recordHistory();
      const lastSid = added[added.length - 1].mpv_sid;
      updateActiveTab((prev) => ({
        ...prev,
        subtitleTracks: [...prev.subtitleTracks, ...added],
        playerState: { ...prev.playerState, sid: lastSid },
      }));
      invoke('player_set_sub_delay', { seconds: 0 }).catch(() => {});
    }
  }, [media, activeTab.subtitleTracks, recordHistory, t, updateActiveTab]);

  const handleExportSingleSubtitle = useCallback(
    async (sub: EditableSubtitleTrack) => {
      if (!media || sub.source_kind !== 'internal' || sub.subtitle_index === undefined) return;
      const ext = subtitleExtForCodec(sub.codec_name);
      const base = getBaseNameWithoutExt(media.file_name);
      const defaultName = buildExportSubtitleFileName(
        base,
        sub.subtitle_index,
        sub.title,
        sub.language,
        ext
      );
      const baseDir = activeTab.outputDir || getDirName(media.file_path);

      const chosen = await save({
        title: t('dlg.exportSingleSubtitle'),
        defaultPath: baseDir ? joinPath(baseDir, defaultName) : defaultName,
        filters: [{ name: `${ext.toUpperCase()}`, extensions: [ext] }],
      });
      if (!chosen) return;

      setIsExtracting(true);
      setExportProgress({
        status: 'running',
        percent: 40,
        out_time_sec: 0,
        expected_duration_sec: duration,
        speed: t('msg.extracting'),
        written_bytes: 0,
        message: t('msg.exportingSub', { title: sub.title }),
        output_path: chosen,
      });

      try {
        await invoke<string[]>('export_subtitle_tracks', {
          inputPath: media.file_path,
          items: [
            {
              subtitle_index: sub.subtitle_index,
              output_path: chosen,
              codec_name: sub.codec_name,
            },
          ],
        });
        setExportProgress({
          status: 'done',
          percent: 100,
          out_time_sec: duration,
          expected_duration_sec: duration,
          speed: '',
          written_bytes: 0,
          message: t('msg.exportedSub', { title: sub.title }),
          output_path: chosen,
        });
      } catch (err) {
        setExportProgress({
          status: 'error',
          percent: 0,
          out_time_sec: 0,
          expected_duration_sec: duration,
          speed: '',
          written_bytes: 0,
          message: String(err),
          output_path: chosen,
        });
      } finally {
        setIsExtracting(false);
      }
    },
    [media, activeTab.outputDir, duration, t]
  );

  const handleExportBatchSubtitles = useCallback(async () => {
    if (!media) return;
    const targets = activeTab.subtitleTracks.filter(
      (s) => s.enabled && s.source_kind === 'internal' && s.subtitle_index !== undefined
    );
    if (targets.length === 0) return;

    const dir = await open({
      directory: true,
      multiple: false,
      title: t('dlg.exportBatchSubtitles', { n: targets.length }),
      defaultPath: activeTab.outputDir || getDirName(media.file_path) || undefined,
    });
    if (typeof dir !== 'string') return;

    const base = getBaseNameWithoutExt(media.file_name);
    const items = targets.map((s) => {
      const idx = s.subtitle_index!;
      const ext = subtitleExtForCodec(s.codec_name);
      const fileName = buildExportSubtitleFileName(base, idx, s.title, s.language, ext);
      return {
        subtitle_index: idx,
        output_path: joinPath(dir, fileName),
        codec_name: s.codec_name,
      };
    });

    setIsExtracting(true);
    setExportProgress({
      status: 'running',
      percent: 35,
      out_time_sec: 0,
      expected_duration_sec: duration,
      speed: t('msg.batchCount', { n: items.length }),
      written_bytes: 0,
      message: t('msg.exportingBatchSub', { n: items.length }),
      output_path: items[0].output_path,
    });

    try {
      const outs = await invoke<string[]>('export_subtitle_tracks', {
        inputPath: media.file_path,
        items,
      });
      setExportProgress({
        status: 'done',
        percent: 100,
        out_time_sec: duration,
        expected_duration_sec: duration,
        speed: '',
        written_bytes: 0,
        message: t('msg.exportedBatchSub', { n: outs.length }),
        output_path: outs[0] || dir,
      });
    } catch (err) {
      setExportProgress({
        status: 'error',
        percent: 0,
        out_time_sec: 0,
        expected_duration_sec: duration,
        speed: '',
        written_bytes: 0,
        message: String(err),
        output_path: dir,
      });
    } finally {
      setIsExtracting(false);
    }
  }, [media, activeTab.subtitleTracks, activeTab.outputDir, duration, t]);

  // Global Keyboard Shortcuts (including fallback Ctrl/Cmd+Z, Y, S, O, W, T, 1..9 & Ctrl+Tab)
  const spaceHeldRef = useRef(false);

  useEffect(() => {
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spaceHeldRef.current = false;
      }
    };
    const onWindowBlur = () => {
      spaceHeldRef.current = false;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      const keyLower = e.key.toLowerCase();

      // Global Undo / Redo (Cmd+Z / Cmd+Shift+Z / Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y)
      if ((e.metaKey || e.ctrlKey) && !e.altKey && keyLower === 'z') {
        if (tag === 'TEXTAREA') return;
        e.preventDefault();
        const now = performance.now();
        if (now - lastUndoRedoAtRef.current < 40) return;
        lastUndoRedoAtRef.current = now;
        if (e.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
        return;
      }
      if (e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && keyLower === 'y') {
        if (tag === 'TEXTAREA') return;
        e.preventDefault();
        const now = performance.now();
        if (now - lastUndoRedoAtRef.current < 40) return;
        lastUndoRedoAtRef.current = now;
        handleRedo();
        return;
      }

      // Project shortcuts (Cmd/Ctrl+S, Cmd/Ctrl+Shift+S, Cmd/Ctrl+Shift+O)
      if ((e.metaKey || e.ctrlKey) && !e.altKey && keyLower === 's') {
        e.preventDefault();
        void handleSaveProject(e.shiftKey);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.shiftKey && keyLower === 'o') {
        e.preventDefault();
        void handleOpenProject();
        return;
      }

      if ((e.metaKey || e.ctrlKey) && !e.altKey && keyLower === 'w') {
        e.preventDefault();
        handleCloseTab(activeTabIdRef.current);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && !e.altKey && keyLower === 't') {
        e.preventDefault();
        handleNewTab();
        return;
      }
      if (
        (e.metaKey || e.ctrlKey) &&
        !e.altKey &&
        !e.shiftKey &&
        e.key >= '1' &&
        e.key <= '9'
      ) {
        e.preventDefault();
        handleSelectTabByIndex(Number(e.key) - 1);
        return;
      }
      if (e.ctrlKey && !e.metaKey && !e.altKey && e.key === 'Tab') {
        e.preventDefault();
        handleStepTab(e.shiftKey ? -1 : 1);
        return;
      }

      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (e.key === 'Escape' && pendingProject) {
        handleCancelMissingMedia();
        return;
      }
      if (e.key === 'Escape' && showDetails) {
        setShowDetails(false);
        return;
      }
      if (e.key === 'Escape' && showUpdateModal) {
        if (updateProgress?.stage !== 'installing' && updateProgress?.stage !== 'restarting') {
          setShowUpdateModal(false);
        }
        return;
      }

      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && keyLower === 'o') {
        e.preventDefault();
        handleImportVideo();
        return;
      }

      if (!media || showDetails || showUpdateModal || pendingProject) return;

      if (e.code === 'Space') {
        e.preventDefault();
        if (!e.repeat && !spaceHeldRef.current) {
          spaceHeldRef.current = true;
          handleTogglePause();
        }
      } else if (e.key === 'ArrowLeft' && e.shiftKey) {
        e.preventDefault();
        handleStepKeyframe('prev');
      } else if (e.key === 'ArrowRight' && e.shiftKey) {
        e.preventDefault();
        handleStepKeyframe('next');
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        handleSeekRelative(-5);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        handleSeekRelative(5);
      } else if (e.key === ',') {
        e.preventDefault();
        handleStepFrame(false);
      } else if (e.key === '.') {
        e.preventDefault();
        handleStepFrame(true);
      } else if (keyLower === 'i') {
        e.preventDefault();
        if (!e.repeat) handleMarkIn();
      } else if (keyLower === 'o') {
        e.preventDefault();
        if (!e.repeat) handleMarkOut();
      } else if (keyLower === 's' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        if (!e.repeat) handleToggleSkimming();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onWindowBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onWindowBlur);
    };
  }, [
    media,
    showDetails,
    showUpdateModal,
    pendingProject,
    updateProgress?.stage,
    handleUndo,
    handleRedo,
    handleSaveProject,
    handleOpenProject,
    handleCancelMissingMedia,
    handleCloseTab,
    handleNewTab,
    handleSelectTabByIndex,
    handleStepTab,
    handleImportVideo,
    handleTogglePause,
    handleStepKeyframe,
    handleSeekRelative,
    handleStepFrame,
    handleMarkIn,
    handleMarkOut,
    handleToggleSkimming,
  ]);

  // Export Lossless MKV / MP4 for active tab
  const handleStartExport = useCallback(async () => {
    if (!media || keptSegments.length === 0) return;
    handleSkimEnd(false);

    invoke('player_set_pause', { paused: true }).catch(() => {});

    const fmt = activeTab.exportFormat;
    const baseDir = activeTab.outputDir || getDirName(media.file_path);
    const defaultName = `${getBaseNameWithoutExt(media.file_name)}-edit.${fmt}`;
    const defaultPath = baseDir ? joinPath(baseDir, defaultName) : defaultName;

    const chosen = await save({
      title: t('dlg.exportVideoTitle', { fmt }),
      defaultPath,
      filters:
        fmt === 'mp4'
          ? [
              { name: 'MP4 视频 (.mp4)', extensions: ['mp4'] },
              { name: 'Matroska 视频 (.mkv)', extensions: ['mkv'] },
            ]
          : [
              { name: 'Matroska 视频 (.mkv)', extensions: ['mkv'] },
              { name: 'MP4 视频 (.mp4)', extensions: ['mp4'] },
            ],
    });

    if (!chosen) return;

    let finalFormat: 'mkv' | 'mp4' = fmt;
    let outputPath = chosen;
    if (/\.mp4$/i.test(chosen)) {
      finalFormat = 'mp4';
    } else if (/\.mkv$/i.test(chosen)) {
      finalFormat = 'mkv';
    } else {
      outputPath = `${chosen}.${fmt}`;
    }

    const chosenDir = getDirName(outputPath);
    updateActiveTab((prev) => ({
      ...prev,
      outputDir: chosenDir || prev.outputDir,
      exportFormat: finalFormat,
    }));

    let finalSegments = keptSegments;
    if (snapKeyframes && keyframes.length === 0 && !isFullFile) {
      try {
        const snapped = [];
        for (const seg of keptSegments) {
          let s = seg.start;
          let e = seg.end;
          if (s > 0.05) {
            const nearS = await invoke<number[]>('get_keyframes_near', {
              filePath: media.file_path,
              targetTime: s,
              windowSec: 15,
            });
            if (nearS.length > 0) s = snapToNearestKeyframe(s, nearS, duration);
          }
          if (e < duration - 0.05) {
            const nearE = await invoke<number[]>('get_keyframes_near', {
              filePath: media.file_path,
              targetTime: e,
              windowSec: 15,
            });
            if (nearE.length > 0) e = snapToNearestKeyframe(e, nearE, duration);
          }
          if (e > s + 0.05) snapped.push({ start: s, end: e });
        }
        if (snapped.length > 0) finalSegments = snapped;
      } catch {
        // Proceed with requested segments
      }
    }

    const enabledSubtitles = activeTab.subtitleTracks.filter((s) => s.enabled);

    const request = {
      input_path: media.file_path,
      output_path: outputPath,
      output_format: finalFormat,
      total_source_duration: duration,
      is_full_file: isFullFile,
      kept_segments: finalSegments,
      keep_audio_tracks: activeTab.audioTracks
        .filter((t) => t.enabled && t.source_kind === 'internal')
        .map((t) => ({
          audio_index: t.audio_index,
          title: t.title.trim() || `音轨 ${t.audio_index + 1}`,
          language: t.language.trim() || null,
          is_default: t.is_default,
        })),
      external_audio_tracks: activeTab.audioTracks
        .filter((t) => t.enabled && t.source_kind === 'external' && t.file_path)
        .map((t) => ({
          file_path: t.file_path!,
          title: t.title.trim() || '外部音轨',
          language: t.language.trim() || null,
          is_default: t.is_default,
        })),
      mixed_audio_tracks: activeTab.mixedTracks
        .filter((m) => m.enabled && m.source_audio_indices.length >= 2)
        .map((m) => ({
          source_audio_indices: m.source_audio_indices,
          gains_db: m.source_audio_indices.map((idx) => m.gains_db[idx] ?? 0),
          title: m.title.trim() || '混合音轨',
          codec: m.codec,
          normalize: m.normalize,
          is_default: m.is_default,
        })),
      keep_subtitles: enabledSubtitles.length > 0,
      subtitle_codecs: media.subtitle_tracks.map((s) => s.codec_name),
      subtitle_tracks: enabledSubtitles.map((s) => ({
        source_kind: s.source_kind,
        subtitle_index: s.source_kind === 'internal' ? s.subtitle_index ?? null : null,
        file_path: s.source_kind === 'external' ? s.file_path ?? null : null,
        codec_name: s.codec_name,
        title: s.title.trim(),
        language: s.language.trim() || null,
        is_default: s.is_default,
        delay_sec: s.delay_sec || 0,
      })),
      smart_cut: activeTab.smartCut,
      keyframes: keyframes,
      video_meta: media.video
        ? {
            codec_name: media.video.codec_name,
            fps: media.video.fps,
            pix_fmt: media.video.pix_fmt,
            color_space: media.video.color_space,
            color_transfer: media.video.color_transfer,
            color_primaries: media.video.color_primaries,
            color_range: media.video.color_range,
            time_base_den: media.video.time_base_den,
            master_display: media.video.master_display,
            max_cll: media.video.max_cll,
            format_name: media.format_name,
          }
        : null,
    };

    try {
      await invoke<string>('start_export', { request });
    } catch (err) {
      setExportProgress({
        status: 'error',
        percent: 0,
        out_time_sec: 0,
        expected_duration_sec: duration,
        speed: '',
        written_bytes: 0,
        message: String(err),
        output_path: outputPath,
      });
    }
  }, [
    media,
    activeTab,
    keptSegments,
    isFullFile,
    snapKeyframes,
    keyframes,
    duration,
    updateActiveTab,
  ]);

  const canExport = Boolean(media && keptSegments.length > 0);
  const isBusyWorkspace = isExporting || isLoadingProject;

  return (
    <div className="w-full h-full flex flex-col bg-[#090b10] text-zinc-100 overflow-hidden">
      {/* Multi-Tab Strip (Cmd+T new tab, Cmd+W close tab) */}
      <TabBar
        tabs={tabs}
        activeTabId={effectiveActiveTabId}
        disabled={isBusyWorkspace}
        onSelectTab={handleSelectTab}
        onCloseTab={handleCloseTab}
        onNewTab={handleNewTab}
      />

      <TopBar
        media={media}
        toolStatus={toolStatus}
        outputDir={activeTab.outputDir}
        exportFormat={activeTab.exportFormat}
        isExporting={isBusyWorkspace}
        isAnalyzing={activeTab.isAnalyzing}
        canExport={canExport}
        canUndo={historyCounts.past > 0}
        canRedo={historyCounts.future > 0}
        currentProjectName={currentProjectName}
        hasUpdateAvailable={Boolean(updateCheckResult?.has_update)}
        latestVersion={updateCheckResult?.latest_version ?? null}
        isUpdatingApp={
          isCheckingUpdate ||
          updateProgress?.stage === 'downloading' ||
          updateProgress?.stage === 'installing' ||
          updateProgress?.stage === 'restarting'
        }
        onUndo={handleUndo}
        onRedo={handleRedo}
        onSaveProject={() => void handleSaveProject(false)}
        onSaveProjectAs={() => void handleSaveProject(true)}
        onOpenProject={() => void handleOpenProject()}
        onOpenUpdateModal={() => {
          setShowUpdateModal(true);
          if (!updateCheckResult && !isCheckingUpdate) {
            void handleCheckUpdate(false);
          }
        }}
        onImportVideo={handleImportVideo}
        onCloseVideo={handleCloseVideoInTab}
        onOpenDetails={() => setShowDetails(true)}
        onPickOutputDir={handlePickOutputDir}
        onExportFormatChange={(fmt) => {
          if (fmt === activeTab.exportFormat) return;
          recordHistory();
          updateActiveTab((prev) => ({ ...prev, exportFormat: fmt }));
        }}
        onStartExport={handleStartExport}
      />

      {/* Middle Studio Workspace */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* Left: Native libmpv HDR Video Viewport + Transport Controls */}
        <div className="flex-1 min-w-0 flex flex-col bg-black">
          <VideoViewport
            media={media}
            isNativeReady={isNativeReady}
            hideNativeView={
              showDetails || needsLanguageSetup || showUpdateModal || Boolean(pendingProject)
            }
            errorMsg={activeTab.playerError}
            onImportVideo={handleImportVideo}
            onTogglePause={handleTogglePause}
          />
          <PlaybackControls
            disabled={!media}
            playerState={playerState}
            duration={duration}
            fps={media?.video?.fps || 30}
            isHdrVideo={Boolean(media?.video?.is_hdr)}
            draftIn={activeTab.draftIn}
            draftOut={activeTab.draftOut}
            audioTracks={activeTab.audioTracks}
            subtitleTracks={activeTab.subtitleTracks}
            onTogglePause={handleTogglePause}
            onSeek={handleSeek}
            onSeekRelative={handleSeekRelative}
            onStepFrame={handleStepFrame}
            onStepKeyframe={handleStepKeyframe}
            onSetVolume={handleSetVolume}
            onSetSpeed={handleSetSpeed}
            onToggleHdr={handleToggleHdr}
            onSelectPreviewAudio={handleSelectPreviewAudio}
            onSelectPreviewSubtitle={handleSelectPreviewSubtitle}
            onMarkIn={handleMarkIn}
            onMarkOut={handleMarkOut}
            onCommitDraftRange={handleCommitDraftRange}
          />
        </div>

        {/* Right: Tabbed Inspector (剪辑 | 音轨 | 字幕) */}
        <aside className="w-[385px] shrink-0 bg-[#0d1017] border-l border-white/[0.08] flex flex-col overflow-hidden">
          <div className="h-[42px] px-2 border-b border-white/[0.07] flex items-center gap-1 shrink-0">
            <button
              onClick={() => updateActiveTab((prev) => ({ ...prev, activePanelTab: 'cut' }))}
              className={`flex-1 h-8 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                activeTab.activePanelTab === 'cut'
                  ? 'bg-white/[0.1] text-white'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04]'
              }`}
            >
              <Scissors className="w-3.5 h-3.5 text-rose-400" />
              <span>{t('panel.cut')}</span>
              {activeTab.ranges.length > 0 && (
                <span className="px-1.5 rounded-full bg-rose-500/25 text-rose-300 text-[10px] font-mono-num">
                  {activeTab.ranges.length}
                </span>
              )}
            </button>

            <button
              onClick={() => updateActiveTab((prev) => ({ ...prev, activePanelTab: 'audio' }))}
              className={`flex-1 h-8 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                activeTab.activePanelTab === 'audio'
                  ? 'bg-white/[0.1] text-white'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04]'
              }`}
            >
              <Volume2 className="w-3.5 h-3.5 text-cyan-400" />
              <span>{t('panel.audio')}</span>
              {activeTab.audioTracks.length + activeTab.mixedTracks.length > 0 && (
                <span className="px-1.5 rounded-full bg-cyan-500/20 text-cyan-300 text-[10px] font-mono-num">
                  {activeTab.audioTracks.length + activeTab.mixedTracks.length}
                </span>
              )}
            </button>

            <button
              onClick={() => updateActiveTab((prev) => ({ ...prev, activePanelTab: 'subtitle' }))}
              className={`flex-1 h-8 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                activeTab.activePanelTab === 'subtitle'
                  ? 'bg-white/[0.1] text-white'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04]'
              }`}
            >
              <Subtitles className="w-3.5 h-3.5 text-sky-400" />
              <span>{t('panel.subtitle')}</span>
              {activeTab.subtitleTracks.length > 0 && (
                <span className="px-1.5 rounded-full bg-sky-500/20 text-sky-300 text-[10px] font-mono-num">
                  {activeTab.subtitleTracks.length}
                </span>
              )}
            </button>
          </div>

          <div className="flex-1 min-h-0 overflow-hidden">
            {activeTab.activePanelTab === 'cut' ? (
              <CutListPanel
                duration={duration}
                currentTime={playerState.time_pos}
                keyframes={keyframes}
                cutMode={activeTab.cutMode}
                ranges={activeTab.ranges}
                keptSegments={keptSegments}
                snapKeyframes={snapKeyframes}
                onCutModeChange={(mode) => {
                  if (mode === activeTab.cutMode) return;
                  recordHistory();
                  updateActiveTab((prev) => ({ ...prev, cutMode: mode }));
                }}
                onAddRange={handleAddRange}
                onAddBatchRanges={handleAddBatchRanges}
                onUpdateRange={handleUpdateRange}
                onDeleteRange={handleDeleteRange}
                onClearRanges={() => {
                  if (activeTab.ranges.length === 0) return;
                  recordHistory();
                  updateActiveTab((prev) => ({ ...prev, ranges: [] }));
                }}
                onSeek={handleSeek}
              />
            ) : activeTab.activePanelTab === 'audio' ? (
              <AudioTrackPanel
                hasMedia={Boolean(media)}
                tracks={activeTab.audioTracks}
                mixedTracks={activeTab.mixedTracks}
                activePreviewAid={playerState.aid}
                isBusy={isBusyWorkspace}
                onPreviewTrack={handleSelectPreviewAudio}
                onUpdateTrack={handleUpdateAudioTrack}
                onToggleAllTracks={handleToggleAllAudioTracks}
                onMoveTrack={handleMoveAudioTrack}
                onDeleteTrack={handleDeleteAudioTrack}
                onDeleteCheckedTracks={handleDeleteCheckedAudioTracks}
                onSetDefaultTrack={handleSetDefaultAudioTrack}
                onImportAudioTrack={handleImportAudioTrack}
                onExportSingleAudio={handleExportSingleAudio}
                onExportBatchAudio={handleExportBatchAudio}
                onAddMixedTrack={(mix) => {
                  recordHistory();
                  updateActiveTab((prev) => ({
                    ...prev,
                    mixedTracks: [...prev.mixedTracks, mix],
                  }));
                }}
                onUpdateMixedTrack={(id, patch) => {
                  recordHistory(patch.enabled !== undefined ? undefined : `mix-edit-${id}`);
                  updateActiveTab((prev) => ({
                    ...prev,
                    mixedTracks: prev.mixedTracks.map((m) =>
                      m.id === id ? { ...m, ...patch } : m
                    ),
                  }));
                }}
                onDeleteMixedTrack={(id) => {
                  recordHistory();
                  updateActiveTab((prev) => ({
                    ...prev,
                    mixedTracks: prev.mixedTracks.filter((m) => m.id !== id),
                  }));
                }}
              />
            ) : (
              <SubtitlePanel
                hasMedia={Boolean(media)}
                subtitles={activeTab.subtitleTracks}
                activePreviewSid={playerState.sid}
                isBusy={isBusyWorkspace}
                onPreviewSubtitle={handleSelectPreviewSubtitle}
                onUpdateSubtitle={handleUpdateSubtitle}
                onToggleAllSubtitles={handleToggleAllSubtitles}
                onSetSubtitleDelay={handleSetSubtitleDelay}
                onBatchShiftSubtitles={handleBatchShiftSubtitles}
                onBatchSetSubtitlesDelay={handleBatchSetSubtitlesDelay}
                onSetDefaultSubtitle={handleSetDefaultSubtitle}
                onDeleteSubtitle={handleDeleteSubtitle}
                onDeleteCheckedSubtitles={handleDeleteCheckedSubtitles}
                onImportSubtitle={handleImportSubtitle}
                onExportSingleSubtitle={handleExportSingleSubtitle}
                onExportBatchSubtitles={handleExportBatchSubtitles}
              />
            )}
          </div>
        </aside>
      </div>

      {/* Bottom Full-Width Canvas 2D Precision Timeline */}
      <Timeline
        duration={duration}
        currentTime={playerState.time_pos}
        keyframes={keyframes}
        cutMode={activeTab.cutMode}
        ranges={activeTab.ranges}
        keptSegments={keptSegments}
        draftIn={activeTab.draftIn}
        draftOut={activeTab.draftOut}
        smartCut={activeTab.smartCut}
        skimmingEnabled={skimmingEnabled}
        onToggleSmartCut={() => {
          recordHistory();
          updateActiveTab((prev) => ({ ...prev, smartCut: !prev.smartCut }));
        }}
        onToggleSkimming={handleToggleSkimming}
        onSkimMove={handleSkimMove}
        onSkimEnd={handleSkimEnd}
        onSkimCommit={handleSkimCommit}
        onSeek={handleSeek}
        onUpdateRange={handleUpdateRange}
      />

      {/* Top-Left Floating Rounded Toast Notifications (strictly inside top 88px chrome above native video) */}
      {(exportProgress ||
        (!showUpdateModal &&
          updateProgress &&
          (updateProgress.stage === 'downloading' ||
            updateProgress.stage === 'installing' ||
            updateProgress.stage === 'restarting'))) && (
        <div className="fixed top-1.5 left-3 z-50 flex items-start gap-2.5 max-w-[calc(100vw-24px)] pointer-events-none">
          <ExportProgressBar
            progress={exportProgress}
            canCancel={!isLoadingProject}
            onCancel={() => invoke('cancel_export').catch(() => {})}
            onRevealOutput={(p) => invoke('reveal_in_folder', { path: p }).catch(() => {})}
            onDismiss={() => setExportProgress(null)}
          />

          {!showUpdateModal &&
            updateProgress &&
            (updateProgress.stage === 'downloading' ||
              updateProgress.stage === 'installing' ||
              updateProgress.stage === 'restarting') && (
              <div className="pointer-events-auto w-[370px] max-w-[calc(100vw-24px)] max-h-[78px] rounded-2xl border border-emerald-400/55 ring-1 ring-emerald-400/20 bg-[#0b2a1e]/95 backdrop-blur-md shadow-2xl shadow-black/75 px-3.5 py-2.5 text-xs">
                <div className="flex items-center gap-2 text-emerald-50 h-5 min-w-0">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
                  <span className="font-medium truncate">
                    {updateProgress.stage === 'downloading'
                      ? t('upd.bannerAutoDownloading', {
                          v: updateCheckResult?.latest_version || '',
                          p: updateProgress.percent.toFixed(0),
                        })
                      : t('upd.bannerInstalling', {
                          v: updateCheckResult?.latest_version || '',
                        })}
                  </span>
                </div>
                <div className="mt-2 flex items-center justify-between gap-2.5 h-7">
                  <div className="flex-1 min-w-0">
                    {updateProgress.stage === 'downloading' && (
                      <div className="h-1.5 rounded-full bg-white/[0.1] overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-emerald-400 to-cyan-400 transition-all duration-200"
                          style={{ width: `${Math.max(2, Math.min(100, updateProgress.percent))}%` }}
                        />
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => setShowUpdateModal(true)}
                      className="h-7 px-3 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-[11px] font-semibold cursor-pointer transition-colors"
                    >
                      {t('upd.bannerView')}
                    </button>
                    {updateProgress.stage === 'downloading' && (
                      <button
                        type="button"
                        onClick={handleCancelUpdate}
                        className="h-7 px-2.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 text-[11px] text-rose-200 cursor-pointer transition-colors"
                      >
                        {t('upd.cancel')}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
        </div>
      )}

      {/* PotPlayer-style Media Details Modal (native video view auto-hidden while open) */}
      <MediaDetailsModal media={media} open={showDetails} onClose={() => setShowDetails(false)} />

      {/* Software Update & Auto-Update Settings Modal */}
      <UpdateModal
        open={showUpdateModal}
        currentVersion={updateCheckResult?.current_version || APP_VERSION}
        autoUpdateEnabled={autoUpdateEnabled}
        isChecking={isCheckingUpdate}
        checkResult={updateCheckResult}
        checkError={updateCheckError}
        progress={updateProgress}
        isBusyExporting={isExporting}
        onClose={() => setShowUpdateModal(false)}
        onToggleAutoUpdate={handleToggleAutoUpdate}
        onCheckNow={() => void handleCheckUpdate(false)}
        onInstallNow={() => void handleInstallUpdate()}
        onCancelInstall={handleCancelUpdate}
      />

      {/* Missing Media Relink Modal when opening a .hdrcut project with moved/deleted source files */}
      <MissingMediaModal
        open={Boolean(pendingProject) && missingMediaItems.length > 0}
        projectName={pendingProject?.name || ''}
        items={missingMediaItems}
        onLocateItem={(key) => void handleLocateMissingMedia(key)}
        onToggleSkipItem={handleToggleSkipMissingMedia}
        onCancel={handleCancelMissingMedia}
        onConfirm={() => void handleConfirmMissingMedia()}
      />

      {/* First-Launch Language Selection Modal (English / 简体中文) */}
      <LanguageModal open={needsLanguageSetup} />
    </div>
  );
}

export default App;
