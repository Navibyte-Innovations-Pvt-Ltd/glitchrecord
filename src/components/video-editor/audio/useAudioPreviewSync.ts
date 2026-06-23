import { useCallback, useEffect, useMemo, useRef } from "react";
import { buildResolvedAudioPlan } from "@/lib/exporter/audioRoutingEngine";
import { resolveMediaElementSource } from "@/lib/exporter/localMediaSource";
import {
  clampMediaTimeToDuration,
  enablePitchPreservingPlayback,
  estimateCompanionAudioStartDelaySeconds,
  resolveOverlayPlaybackRate,
} from "@/lib/mediaTiming";
import type { AudioRegion, SpeedRegion } from "../types";
import { computeMixHeadroom } from "./mixHeadroom";

const SOURCE_AUDIO_PREVIEW_PLAYING_SEEK_DRIFT_SECONDS = 0.18;
const SOURCE_AUDIO_PREVIEW_PAUSED_SEEK_DRIFT_SECONDS = 0.01;

interface UseAudioPreviewSyncParams {
  audioRegions: AudioRegion[];
  previewVolume: number;
  isPlaying: boolean;
  currentTime: number;
  timelineTime: number;
  duration: number;
  effectiveSpeedRegions: SpeedRegion[];
  previewSourceAudioFallbackPaths: string[];
  sourceAudioFallbackStartDelayMsByPath: Record<string, number>;
  isCurrentClipMuted: boolean;
  getSourceTrackPreviewGain: (audioPath: string) => number;
  // The effective embedded <video> preview volume (after mutes + previewVolume).
  // Counted into the mix headroom so narration + video can't sum past the device
  // clip point. Pure number — the hook only reads it for the headroom calc.
  embeddedVideoPreviewVolume: number;
  onSourceFallbackLoadError: (error: unknown) => void;
}

export function useAudioPreviewSync({
  audioRegions,
  previewVolume,
  isPlaying,
  currentTime,
  timelineTime,
  duration,
  effectiveSpeedRegions,
  previewSourceAudioFallbackPaths,
  sourceAudioFallbackStartDelayMsByPath,
  isCurrentClipMuted,
  getSourceTrackPreviewGain,
  embeddedVideoPreviewVolume,
  onSourceFallbackLoadError,
}: UseAudioPreviewSyncParams) {
  const resolvedPlan = useMemo(
    () =>
      buildResolvedAudioPlan({
        videoResource: null,
        sourceAudioFallbackPaths: previewSourceAudioFallbackPaths,
        audioRegions,
      }),
    [audioRegions, previewSourceAudioFallbackPaths],
  );
  const resolvedUserTracks = useMemo(
    () => resolvedPlan.tracks.filter((track) => track.kind === "user"),
    [resolvedPlan],
  );
  const resolvedSourceTracks = useMemo(
    () => resolvedPlan.tracks.filter((track) => track.kind !== "user"),
    [resolvedPlan],
  );

  // Preview anti-clip headroom. Narration + source + embedded video each play as
  // independent HTMLAudioElements that SUM at the device output with no limiter —
  // two near-full-scale sources sum past ±1.0 → the device hard-clips ("speaker
  // tearing"). The raw narration file alone is one source, so it stays clean.
  // Compute a single multiplier (≤1) that pulls the summed peak back to the
  // ceiling, applied to every source so the mix balance is preserved (this is the
  // preview equivalent of the export soft limiter).
  const previewMixHeadroom = useMemo(() => {
    const pv = Math.max(0, Math.min(1, previewVolume));
    const userVols = resolvedUserTracks.map((t) =>
      Math.max(0, Math.min(1, t.gain * pv)),
    );
    const sourceVols = resolvedSourceTracks.map((t) =>
      Math.max(0, Math.min(1, getSourceTrackPreviewGain(t.sourceRef.path) * (isCurrentClipMuted ? 0 : pv))),
    );
    return computeMixHeadroom([
      ...userVols,
      ...sourceVols,
      Math.max(0, Math.min(1, embeddedVideoPreviewVolume)),
    ]);
  }, [
    resolvedUserTracks,
    resolvedSourceTracks,
    previewVolume,
    isCurrentClipMuted,
    embeddedVideoPreviewVolume,
    getSourceTrackPreviewGain,
  ]);

  const audioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const audioElementRevokersRef = useRef<Map<string, () => void>>(new Map());
  const audioElementResourcesRef = useRef<Map<string, string>>(new Map());
  const sourceAudioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const sourceAudioMediaNodesRef = useRef<Map<string, MediaElementAudioSourceNode>>(new Map());
  const sourceAudioGainNodesRef = useRef<Map<string, GainNode>>(new Map());
  const sourceAudioElementRevokersRef = useRef<Map<string, () => void>>(new Map());
  const sourceAudioElementResourcesRef = useRef<Map<string, string>>(new Map());
  const sourceAudioContextRef = useRef<AudioContext | null>(null);
  const sourceAudioMasterGainRef = useRef<GainNode | null>(null);
  const sourceAudioResumePromiseRef = useRef<Promise<void> | null>(null);
  const lastSourceAudioSyncTimeRef = useRef<number | null>(null);

  const ensureSourceAudioContext = useCallback(() => {
    if (!sourceAudioContextRef.current) {
      const context = new AudioContext({ latencyHint: "interactive" });
      const masterGain = context.createGain();
      masterGain.gain.value = 1;
      masterGain.connect(context.destination);
      sourceAudioContextRef.current = context;
      sourceAudioMasterGainRef.current = masterGain;
    }
    return sourceAudioContextRef.current;
  }, []);

  const ensureSourceAudioRunning = useCallback(() => {
    const context = ensureSourceAudioContext();
    if (context.state === "running") {
      return Promise.resolve();
    }
    if (!sourceAudioResumePromiseRef.current) {
      sourceAudioResumePromiseRef.current = context
        .resume()
        .catch(() => undefined)
        .finally(() => {
          sourceAudioResumePromiseRef.current = null;
        });
    }
    return sourceAudioResumePromiseRef.current;
  }, [ensureSourceAudioContext]);

  const playSourceAudioPreview = useCallback(() => {
    void ensureSourceAudioRunning();
    for (const audio of sourceAudioElementsRef.current.values()) {
      if (!audio.src) continue;
      audio.play().catch(() => undefined);
    }
  }, [ensureSourceAudioRunning]);

  useEffect(() => {
    let cancelled = false;
    const existing = audioElementsRef.current;
    const currentIds = new Set(resolvedUserTracks.map((track) => track.id));

    for (const [id, audio] of existing) {
      if (!currentIds.has(id)) {
        audio.pause();
        audio.src = "";
        audioElementRevokersRef.current.get(id)?.();
        audioElementRevokersRef.current.delete(id);
        audioElementResourcesRef.current.delete(id);
        existing.delete(id);
      }
    }

    for (const track of resolvedUserTracks) {
      let audio = existing.get(track.id);
      if (!audio) {
        audio = new Audio();
        audio.preload = "auto";
        const el = audio;
        el.addEventListener("error", () =>
          console.warn("[GG-audio] failed to load narration/audio track:", el.src, el.error?.message),
        );
        existing.set(track.id, audio);
      }

      if (audioElementResourcesRef.current.get(track.id) !== track.sourceRef.path) {
        audio.pause();
        audio.src = "";
        audioElementRevokersRef.current.get(track.id)?.();
        audioElementRevokersRef.current.delete(track.id);
        audioElementResourcesRef.current.set(track.id, track.sourceRef.path);

        void (async () => {
          const resolved = await resolveMediaElementSource(track.sourceRef.path);
          const latestAudio = existing.get(track.id);

          if (
            cancelled ||
            latestAudio !== audio ||
            audioElementResourcesRef.current.get(track.id) !== track.sourceRef.path
          ) {
            resolved.revoke();
            return;
          }

          audioElementRevokersRef.current.set(track.id, resolved.revoke);
          latestAudio.src = resolved.src;
        })();
      }

      audio.volume = Math.max(0, Math.min(1, track.gain * previewVolume * previewMixHeadroom));
    }

    return () => {
      cancelled = true;
    };
  }, [previewVolume, resolvedUserTracks, previewMixHeadroom]);

  useEffect(() => {
    let cancelled = false;
    const existing = sourceAudioElementsRef.current;
    const currentIds = new Set(resolvedSourceTracks.map((track) => track.sourceRef.path));

    for (const [id, audio] of existing) {
      if (!currentIds.has(id)) {
        audio.pause();
        audio.src = "";
        sourceAudioMediaNodesRef.current.get(id)?.disconnect();
        sourceAudioMediaNodesRef.current.delete(id);
        sourceAudioGainNodesRef.current.get(id)?.disconnect();
        sourceAudioGainNodesRef.current.delete(id);
        sourceAudioElementRevokersRef.current.get(id)?.();
        sourceAudioElementRevokersRef.current.delete(id);
        sourceAudioElementResourcesRef.current.delete(id);
        existing.delete(id);
      }
    }

    for (const track of resolvedSourceTracks) {
      const audioPath = track.sourceRef.path;
      let audio = existing.get(audioPath);
      if (!audio) {
        audio = new Audio();
        audio.preload = "auto";
        audio.crossOrigin = "anonymous";
        existing.set(audioPath, audio);
      }
      audio.volume = 1;
      audio.dataset.sourceAudioPath = audioPath;

      // Web Audio API createMediaElementSource breaks preservesPitch on Chromium.
      // We route directly through the HTMLAudioElement to ensure pitch preservation works
      // during speed changes. Note: this limits maximum preview volume to 1.0 (100%).

      if (sourceAudioElementResourcesRef.current.get(audioPath) !== audioPath) {
        audio.pause();
        audio.src = "";
        sourceAudioElementRevokersRef.current.get(audioPath)?.();
        sourceAudioElementRevokersRef.current.delete(audioPath);
        sourceAudioElementResourcesRef.current.set(audioPath, audioPath);

        void (async () => {
          try {
            const resolved = await resolveMediaElementSource(audioPath);
            const latestAudio = existing.get(audioPath);

            if (
              cancelled ||
              latestAudio !== audio ||
              sourceAudioElementResourcesRef.current.get(audioPath) !== audioPath
            ) {
              resolved.revoke();
              return;
            }

            sourceAudioElementRevokersRef.current.set(audioPath, resolved.revoke);
            latestAudio.src = resolved.src;
            latestAudio.load();
            if (isPlaying) {
              playSourceAudioPreview();
            }
          } catch (error) {
            if (cancelled) {
              return;
            }

            sourceAudioElementRevokersRef.current.get(audioPath)?.();
            sourceAudioElementRevokersRef.current.delete(audioPath);
            sourceAudioElementResourcesRef.current.delete(audioPath);
            const latestAudio = existing.get(audioPath);
            if (latestAudio === audio) {
              latestAudio.pause();
              latestAudio.src = "";
            }
            onSourceFallbackLoadError(error);
          }
        })();
      }

      audio.volume = Math.max(0, Math.min(1, getSourceTrackPreviewGain(audioPath) * (isCurrentClipMuted ? 0 : previewVolume) * previewMixHeadroom));
    }

    if (sourceAudioMasterGainRef.current) {
      sourceAudioMasterGainRef.current.gain.value = isCurrentClipMuted
        ? 0
        : Math.max(0, Math.min(1, previewVolume));
    }

    if (resolvedSourceTracks.length === 0) {
      lastSourceAudioSyncTimeRef.current = null;
    }

    return () => {
      cancelled = true;
    };
  }, [
    getSourceTrackPreviewGain,
    isPlaying,
    isCurrentClipMuted,
    onSourceFallbackLoadError,
    resolvedSourceTracks,
    previewVolume,
    previewMixHeadroom,
    playSourceAudioPreview,
  ]);

  useEffect(() => {
    return () => {
      for (const audio of audioElementsRef.current.values()) {
        audio.pause();
        audio.src = "";
      }
      for (const revoke of audioElementRevokersRef.current.values()) {
        revoke();
      }
      audioElementsRef.current.clear();
      audioElementRevokersRef.current.clear();
      audioElementResourcesRef.current.clear();
      for (const audio of sourceAudioElementsRef.current.values()) {
        audio.pause();
        audio.src = "";
      }
      for (const node of sourceAudioMediaNodesRef.current.values()) {
        node.disconnect();
      }
      for (const node of sourceAudioGainNodesRef.current.values()) {
        node.disconnect();
      }
      for (const revoke of sourceAudioElementRevokersRef.current.values()) {
        revoke();
      }
      sourceAudioElementsRef.current.clear();
      sourceAudioMediaNodesRef.current.clear();
      sourceAudioGainNodesRef.current.clear();
      sourceAudioElementRevokersRef.current.clear();
      sourceAudioElementResourcesRef.current.clear();
      if (sourceAudioMasterGainRef.current) {
        sourceAudioMasterGainRef.current.disconnect();
        sourceAudioMasterGainRef.current = null;
      }
      const context = sourceAudioContextRef.current;
      sourceAudioContextRef.current = null;
      sourceAudioResumePromiseRef.current = null;
      if (context) {
        void context.close();
      }
      lastSourceAudioSyncTimeRef.current = null;
    };
  }, []);

  useEffect(() => {
    const currentTimeMs = timelineTime * 1000;
    // Narration / user audio plays at NORMAL speed regardless of clip speed —
    // it's an independent overlay, not part of the video clip being slowed.
    const targetPlaybackRate = 1;

    for (const track of resolvedUserTracks) {
      const audio = audioElementsRef.current.get(track.id);
      if (!audio) continue;

      const startMs = track.timelineBinding.startMs;
      const endMs = track.timelineBinding.endMs;
      const isInRegion = currentTimeMs >= startMs && currentTimeMs < endMs;

      if (isPlaying && isInRegion) {
        enablePitchPreservingPlayback(audio);
        // Background-music bed loops to fill the whole region. Let the element
        // loop natively (gapless) and seek to the offset modulo the file length
        // so a region longer than the file still plays. Preview is approximate —
        // the export mixer adds the equal-power crossfade at each seam.
        audio.loop = track.loop === true;
        const rawOffsetSec = (currentTimeMs - startMs) / 1000;
        const audioOffset =
          audio.loop && Number.isFinite(audio.duration) && audio.duration > 0
            ? rawOffsetSec % audio.duration
            : rawOffsetSec;
        if (Math.abs(audio.currentTime - audioOffset) > 0.2) {
          audio.currentTime = audioOffset;
        }
        // Fixed rate, NOT drift-corrected. getMediaSyncPlaybackRate swings the
        // rate up to ±8% to chase drift; on pitch-preserved SPEECH that warbles
        // the voice → audible "speaker tearing". Drift is handled by the seek
        // above (>0.2s). Same fixed-rate approach as the companion source tracks.
        const syncedPlaybackRate = resolveOverlayPlaybackRate(targetPlaybackRate);
        if (Math.abs(audio.playbackRate - syncedPlaybackRate) > 0.001) {
          audio.playbackRate = syncedPlaybackRate;
        }
        if (audio.paused) {
          audio.play().catch(() => undefined);
        }
      } else if (!audio.paused) {
        audio.pause();
      }
    }
  }, [isPlaying, resolvedUserTracks, timelineTime]);

  useEffect(() => {
    if (resolvedSourceTracks.length === 0) {
      lastSourceAudioSyncTimeRef.current = null;
      return;
    }

    const activeSpeedRegion = effectiveSpeedRegions.find(
      (region) => currentTime * 1000 >= region.startMs && currentTime * 1000 < region.endMs,
    );
    const targetPlaybackRate = activeSpeedRegion ? activeSpeedRegion.speed : 1;
    const previousTimelineTime = lastSourceAudioSyncTimeRef.current;
    const timelineJumped =
      previousTimelineTime === null || Math.abs(currentTime - previousTimelineTime) > 0.25;
    const driftThreshold = isPlaying
      ? SOURCE_AUDIO_PREVIEW_PLAYING_SEEK_DRIFT_SECONDS
      : SOURCE_AUDIO_PREVIEW_PAUSED_SEEK_DRIFT_SECONDS;
    if (sourceAudioMasterGainRef.current) {
      sourceAudioMasterGainRef.current.gain.value = isCurrentClipMuted
        ? 0
        : Math.max(0, Math.min(1, previewVolume));
    }

    for (const audio of sourceAudioElementsRef.current.values()) {
      const sourceAudioPath = audio.dataset.sourceAudioPath ?? "";
      audio.volume = Math.max(0, Math.min(1, getSourceTrackPreviewGain(sourceAudioPath) * (isCurrentClipMuted ? 0 : previewVolume) * previewMixHeadroom));

      enablePitchPreservingPlayback(audio);
      const audioDuration = Number.isFinite(audio.duration) ? audio.duration : null;
      const isMicCompanionTrack = /\.mic\./i.test(sourceAudioPath);
      const rawStartDelaySeconds = estimateCompanionAudioStartDelaySeconds(
        duration,
        audioDuration,
        sourceAudioFallbackStartDelayMsByPath[sourceAudioPath],
      );
      const maxPreviewStartDelaySeconds = isMicCompanionTrack ? 2 : 5;
      const startDelaySeconds = isMicCompanionTrack
        ? 0
        : Number.isFinite(duration) &&
              (rawStartDelaySeconds >= Math.max(0, duration - 0.01) ||
                rawStartDelaySeconds > Math.max(maxPreviewStartDelaySeconds, duration * 0.9))
            ? 0
            : rawStartDelaySeconds;
      const beforeAudioStart = currentTime + 0.001 < startDelaySeconds;
      const targetTime = clampMediaTimeToDuration(currentTime - startDelaySeconds, audioDuration);

      const shouldSeek =
        timelineJumped ||
        (!isPlaying && Math.abs(audio.currentTime - targetTime) > driftThreshold) ||
        (isPlaying && Math.abs(audio.currentTime - targetTime) > 0.9);
      if (shouldSeek) {
        try {
          audio.currentTime = targetTime;
        } catch {
          // no-op
        }
      }

      // KISS for companion source tracks: fixed playback rate avoids audible flutter/stutter
      // from continuous micro-corrections on system audio.
      const syncedPlaybackRate = targetPlaybackRate;
      if (Math.abs(audio.playbackRate - syncedPlaybackRate) > 0.001) {
        audio.playbackRate = syncedPlaybackRate;
      }

      const atEnd = audioDuration !== null && targetTime >= audioDuration;
      if (isPlaying && !beforeAudioStart && !atEnd) {
        void ensureSourceAudioRunning().then(() => {
          audio.play().catch(() => undefined);
        });
      } else if (!audio.paused) {
        audio.pause();
      }
    }

    lastSourceAudioSyncTimeRef.current = currentTime;
  }, [
    currentTime,
    duration,
    effectiveSpeedRegions,
    getSourceTrackPreviewGain,
    isCurrentClipMuted,
    isPlaying,
    previewVolume,
    previewMixHeadroom,
    resolvedSourceTracks,
    sourceAudioFallbackStartDelayMsByPath,
    ensureSourceAudioRunning,
  ]);

  useEffect(() => {
    if (!isPlaying || resolvedSourceTracks.length === 0) {
      return;
    }
    void ensureSourceAudioRunning().then(() => {
      for (const audio of sourceAudioElementsRef.current.values()) {
        if (audio.paused) {
          audio.play().catch(() => undefined);
        }
      }
    });
  }, [isPlaying, resolvedSourceTracks.length, ensureSourceAudioRunning]);

  return { playSourceAudioPreview, previewMixHeadroom };
}
