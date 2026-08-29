import { useEvent } from 'expo';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  PanResponder,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { MapPin, X } from 'lucide-react-native';

import { formatCoordinates, reverseGeocode, formatSnapDateTime } from '../utils/format';

export const IMAGE_DISPLAY_DURATION = 5000;
const HOLD_THRESHOLD_MS = 250;
const TAP_MAX_MOVEMENT = 12;
const SWIPE_DOWN_THRESHOLD = 70;
const SEGMENT_GAP = 3;
const PROGRESS_INTERVAL_MS = 100;

function clamp(value, min, max) {
  return Math.max(min, Math.min(value, max));
}

function TopBar({ visible, onClose, locationName, currentSnap }) {
  const coords = formatCoordinates(currentSnap?.latitude, currentSnap?.longitude);
  const timestamp = currentSnap?._timestamp;
  const dateTime = timestamp ? formatSnapDateTime(timestamp) : '';

  return (
    <View style={[styles.topBar, !visible && styles.hidden]}>
      <TouchableOpacity onPress={onClose} style={styles.closeButton} hitSlop={12}>
        <X color="#fff" size={24} />
      </TouchableOpacity>

      <View style={styles.metaContainer} pointerEvents="none">
        {dateTime ? <Text style={styles.topBarText}>{dateTime}</Text> : null}
        {locationName || coords ? (
          <View style={styles.locationRow}>
            <MapPin color="#fff" size={14} />
            <Text style={styles.topBarText} numberOfLines={1}>
              {locationName || coords}
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

function ProgressSegments({ segments, visible }) {
  return (
    <View style={[styles.progressContainer, !visible && styles.hidden]} pointerEvents="none">
      {segments.map((segment, i) => {
        const fillPct = segment.isActive ? segment.fill * 100 : segment.isPast ? 100 : 0;
        return (
          <View
            key={i}
            style={[
              styles.segmentTrack,
              { width: `${100 / segments.length}%` },
              i < segments.length - 1 && { marginRight: SEGMENT_GAP },
            ]}
          >
            <View style={[styles.segmentFill, { width: `${fillPct}%` }]} />
          </View>
        );
      })}
    </View>
  );
}

export default function StoryViewer({ route, navigation }) {
  const { snaps, startIndex = 0 } = route.params ?? {};
  const [index, setIndex] = useState(startIndex);
  const [uiVisible, setUiVisible] = useState(true);
  const [paused, setPaused] = useState(false);
  const [locationName, setLocationName] = useState(null);
  const [imageProgress, setImageProgress] = useState(0);

  const indexRef = useRef(index);
  const pausedRef = useRef(paused);
  const timerRef = useRef(null);
  const intervalRef = useRef(null);
  const pendingRef = useRef(null);
  const boundsRef = useRef(0);

  useEffect(() => { indexRef.current = index; }, [index]);
  useEffect(() => { pausedRef.current = paused; }, [paused]);

  const safeSnaps = Array.isArray(snaps) ? snaps : [];
  const isVideo = safeSnaps[index]?.media_type === 'video';

  const player = useVideoPlayer(null, p => {
    p.loop = false;
    p.timeUpdateEventInterval = 0.1;
  });

  const currentTime = useVideoTime(player, isVideo);
  const duration = isVideo ? player.duration : 0;
  const status = useVideoStatus(player, isVideo);

  const clearTimers = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const closeViewer = useCallback(() => {
    clearTimers();
    player.pause();
    if (navigation?.goBack) navigation.goBack();
  }, [clearTimers, navigation, player]);

  const goTo = useCallback(
    nextIndex => {
      clearTimers();
      if (nextIndex > safeSnaps.length - 1) {
        closeViewer();
        return;
      }
      if (nextIndex < 0) return;
      setIndex(nextIndex);
    },
    [closeViewer, clearTimers, safeSnaps.length]
  );

  const next = useCallback(() => goTo(indexRef.current + 1), [goTo]);
  const prev = useCallback(() => goTo(indexRef.current - 1), [goTo]);

  const currentSnap = safeSnaps[index];

  // Reset timers/players whenever the active snap changes.
  useEffect(() => {
    if (!currentSnap) return;
    clearTimers();
    setImageProgress(0);
    setLocationName(null);

    if (isVideo) {
      player.replace(currentSnap.mainUrl);
      if (!pausedRef.current) player.play();
    } else {
      player.pause();
      if (!pausedRef.current) {
        const startedAt = Date.now();
        intervalRef.current = setInterval(() => {
          const elapsed = Date.now() - startedAt;
          const progress = clamp(elapsed / IMAGE_DISPLAY_DURATION, 0, 1);
          setImageProgress(progress);
          if (progress >= 1) {
            clearTimers();
            goTo(indexRef.current + 1);
          }
        }, PROGRESS_INTERVAL_MS);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  // Keep play/pause in sync with paused state.
  useEffect(() => {
    if (!isVideo) return;
    if (pausedRef.current) player.pause();
    else player.play();
  }, [isVideo, paused, player]);

  // Advance automatically when a video finishes.
  useEffect(() => {
    if (!isVideo) return;
    const sub = player.addListener('playToEnd', () => goTo(indexRef.current + 1));
    return () => sub.remove();
  }, [isVideo, player, goTo]);

  useEffect(() => {
    if (!currentSnap || currentSnap.latitude == null) return;
    let active = true;
    reverseGeocode(currentSnap.latitude, currentSnap.longitude).then(name => {
      if (active && name) setLocationName(name);
    });
    return () => { active = false; };
  }, [currentSnap]);

  const suspendPlayback = useCallback(() => {
    setPaused(true);
    setUiVisible(false);
    clearTimers();
    if (isVideo) player.pause();
  }, [isVideo, player, clearTimers]);

  const resumePlayback = useCallback(() => {
    setPaused(false);
    setUiVisible(true);
    if (isVideo) {
      player.play();
    } else {
      const startedAt = Date.now();
      intervalRef.current = setInterval(() => {
        const elapsed = Date.now() - startedAt;
        const progress = clamp(elapsed / IMAGE_DISPLAY_DURATION, 0, 1);
        setImageProgress(progress);
        if (progress >= 1) {
          clearTimers();
          goTo(indexRef.current + 1);
        }
      }, PROGRESS_INTERVAL_MS);
    }
  }, [isVideo, player, clearTimers, goTo]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (e, g) =>
          Math.abs(g.dy) > TAP_MAX_MOVEMENT || Math.abs(g.dx) > TAP_MAX_MOVEMENT,
        onPanResponderGrant: evt => {
          pendingRef.current = {
            x: evt.nativeEvent.locationX,
            moved: false,
            holdFired: false,
            holdTimer: setTimeout(() => {
              if (pendingRef.current) {
                pendingRef.current.holdFired = true;
                suspendPlayback();
              }
            }, HOLD_THRESHOLD_MS),
          };
        },
        onPanResponderMove: (evt, g) => {
          if (
            pendingRef.current &&
            (Math.abs(g.dx) > TAP_MAX_MOVEMENT || Math.abs(g.dy) > TAP_MAX_MOVEMENT)
          ) {
            clearTimeout(pendingRef.current.holdTimer);
            pendingRef.current.moved = true;
          }
        },
        onPanResponderRelease: (evt, g) => {
          const pending = pendingRef.current;
          pendingRef.current = null;
          if (!pending) return;

          clearTimeout(pending.holdTimer);

          // Swipe down to exit.
          if (g.dy > SWIPE_DOWN_THRESHOLD && Math.abs(g.dy) > Math.abs(g.dx)) {
            resumePlayback();
            closeViewer();
            return;
          }

          if (pending.holdFired) {
            resumePlayback();
            return;
          }

          if (pending.moved) {
            resumePlayback();
            return;
          }

          // Tap: tap on right half -> next, left half -> previous.
          if (pending.x >= boundsRef.current / 2) next();
          else prev();
        },
        onPanResponderTerminate: () => {
          const pending = pendingRef.current;
          pendingRef.current = null;
          if (pending) {
            clearTimeout(pending.holdTimer);
            if (pending.holdFired) resumePlayback();
          }
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isVideo, next, prev, closeViewer, suspendPlayback, resumePlayback]
  );

  const progress = isVideo
    ? clamp(duration ? currentTime / duration : 0, 0, 1)
    : imageProgress;

  const segments = safeSnaps.map((snap, i) => ({
    fill: i === index ? progress : i < index ? 1 : 0,
    isPast: i < index,
  }));

  if (!currentSnap) {
    return (
      <View style={styles.container}>
        <ActivityIndicator color="#fff" size="large" />
      </View>
    );
  }

  return (
    <View
      style={styles.container}
      {...panResponder.panHandlers}
      onLayout={e => { boundsRef.current = e.nativeEvent.layout.width; }}
    >
      {isVideo ? (
        <VideoView
          player={player}
          style={styles.media}
          contentFit="contain"
          nativeControls={false}
        />
      ) : (
        <Image
          source={{ uri: currentSnap.mainUrl }}
          style={styles.media}
          contentFit="contain"
          transition={150}
        />
      )}

      {currentSnap.has_overlay && currentSnap.overlayUrl ? (
        <Image
          source={{ uri: currentSnap.overlayUrl }}
          style={StyleSheet.absoluteFill}
          contentFit="contain"
          transition={150}
          pointerEvents="none"
        />
      ) : null}

      {isVideo && status === 'loading' ? (
        <View style={styles.media}>
          <ActivityIndicator color="#fff" size="large" />
        </View>
      ) : null}

      <ProgressSegments segments={segments} visible={uiVisible} />

      <TopBar
        visible={uiVisible}
        onClose={closeViewer}
        locationName={locationName}
        currentSnap={currentSnap}
      />

      {currentSnap.caption ? (
        <View style={[styles.captionWrap, !uiVisible && styles.hidden]}>
          <Text style={styles.captionText}>{currentSnap.caption}</Text>
        </View>
      ) : null}
    </View>
  );
}

function useVideoTime(player, isVideo) {
  const event = useEvent(player, 'timeUpdate', { currentTime: player.currentTime });
  return isVideo ? event.currentTime : 0;
}

function useVideoStatus(player, isVideo) {
  const event = useEvent(player, 'statusChange', { status: player.status });
  return isVideo ? event.status : undefined;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  media: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hidden: {
    opacity: 0,
  },
  progressContainer: {
    position: 'absolute',
    top: 48,
    left: 10,
    right: 10,
    flexDirection: 'row',
    zIndex: 30,
  },
  segmentTrack: {
    height: 3,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.35)',
    overflow: 'hidden',
  },
  segmentFill: {
    height: '100%',
    backgroundColor: '#fff',
    borderRadius: 2,
  },
  topBar: {
    position: 'absolute',
    top: 64,
    left: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'flex-start',
    zIndex: 20,
  },
  closeButton: {
    padding: 4,
    marginRight: 10,
  },
  metaContainer: {
    flex: 1,
  },
  topBarText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  captionWrap: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 48,
    zIndex: 20,
  },
  captionText: {
    color: '#fff',
    fontSize: 16,
    lineHeight: 22,
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
});