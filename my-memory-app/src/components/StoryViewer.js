import { useEvent } from 'expo';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import React, { useEffect, useMemo, useRef, useState } from 'react';
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

const IMAGE_DISPLAY_DURATION = 5000;
const HOLD_THRESHOLD_MS = 250;
const TAP_MAX_MOVEMENT = 12;
const SWIPE_DOWN_THRESHOLD = 70;
const SEGMENT_GAP = 3;

function computeProgress(isVideo, currentTime, duration) {
  if (!isVideo) return 0;
  if (!duration) return 0;
  const ratio = currentTime / duration;
  return Math.max(0, Math.min(1, ratio));
}

function TopBar({ visible, onClose, locationName, currentSnap }) {
  const coords = formatCoordinates(currentSnap?.latitude, currentSnap?.longitude);
  const dateTime = formatSnapDateTime(currentSnap?._timestamp);

  return (
    <View style={[styles.topBar, !visible && styles.hidden]}>
      <TouchableOpacity onPress={onClose} style={styles.closeButton} hitSlop={12}>
        <X color="#fff" size={24} />
      </TouchableOpacity>

      <View style={styles.metaContainer} pointerEvents="none">
        {dateTime ? <Text style={styles.metaText}>{dateTime}</Text> : null}
        {locationName || coords ? (
          <View style={styles.locationRow}>
            <MapPin color="#fff" size={14} />
            <Text style={styles.metaText} numberOfLines={1}>
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
        const widthPct = 100 / segments.length;
        const fillPct = segment.isActive ? segment.fill * 100 : segment.isPast ? 100 : 0;
        return (
          <View
            key={i}
            style={[
              styles.segmentTrack,
              { width: `${widthPct}%`, marginRight: i === segments.length - 1 ? 0 : SEGMENT_GAP },
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

  const indexRef = useRef(index);
  const pausedRef = useRef(paused);
  const timerRef = useRef(null);
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

  const { currentTime, duration, status } = useVideoProgress(player, isVideo);

  const closeViewer = () => {
    clearTimer();
    player.pause();
    if (navigation?.goBack) navigation.goBack();
  };

  function clearTimer() {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  function goTo(nextIndex) {
    clearTimer();
    const last = safeSnaps.length - 1;
    if (nextIndex > last) {
      closeViewer();
      return;
    }
    if (nextIndex < 0) {
      return;
    }
    setIndex(nextIndex);
  }

  const next = () => goTo(indexRef.current + 1);
  const prev = () => goTo(indexRef.current - 1);

  // Reset the players/timers whenever the active snap changes.
  useEffect(() => {
    const snap = safeSnaps[index];
    if (!snap) return;

    setLocationName(null);
    if (isVideo) {
      player.replace(snap.mainUrl);
      if (!pausedRef.current) player.play();
    } else {
      player.pause();
    }

    if (!isVideo && !pausedRef.current) {
      timerRef.current = setTimeout(() => goTo(indexRef.current + 1), IMAGE_DISPLAY_DURATION);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, isVideo]);

  // Keep pause/resume in sync with paused state.
  useEffect(() => {
    if (!isVideo) return;
    if (pausedRef.current) player.pause();
    else player.play();
  }, [isVideo, paused, player]);

  // Advance automatically when a video finishes.
  useEventListenerForEnd(player, isVideo, goTo, indexRef);

  useEffect(() => {
    const snap = safeSnaps[index];
    if (!snap || snap.latitude == null) return;
    let active = true;
    reverseGeocode(snap.latitude, snap.longitude).then(name => {
      if (active && name) setLocationName(name);
    });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  function startHold() {
    setPaused(true);
    setUiVisible(false);
    clearTimer();
    if (isVideo) player.pause();
  }

  function endHold() {
    setPaused(false);
    setUiVisible(true);
    if (isVideo) player.play();
    else if (!pausedRef.current) {
      timerRef.current = setTimeout(() => goTo(indexRef.current + 1), IMAGE_DISPLAY_DURATION);
    }
  }

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
                startHold();
              }
            }, HOLD_THRESHOLD_MS),
          };
        },
        onPanResponderMove: (evt, g) => {
          if (pendingRef.current && (Math.abs(g.dx) > TAP_MAX_MOVEMENT || Math.abs(g.dy) > TAP_MAX_MOVEMENT)) {
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
            endHold();
            closeViewer();
            return;
          }

          if (pending.holdFired) {
            endHold();
            return;
          }

          if (pending.moved) {
            endHold();
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
            if (pending.holdFired) endHold();
          }
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isVideo]
  );

  const progress = computeProgress(isVideo, currentTime, duration);

  const segments = safeSnaps.map((snap, i) => ({
    fill: i === index ? progress : i < index ? 1 : 0,
    isPast: i < index,
  }));

  const currentSnap = safeSnaps[index];

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
        <ActivityIndicator color="#fff" style={styles.media} size="large" />
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

function useVideoProgress(player, isVideo) {
  const timeUpdate = useEvent(player, 'timeUpdate', {
    currentTime: player.currentTime,
  });
  const statusChange = useEvent(player, 'statusChange', { status: player.status });

  return {
    currentTime: isVideo ? timeUpdate.currentTime : 0,
    duration: player.duration,
    status: statusChange.status,
  };
}

function useEventListenerForEnd(player, isVideo, onEnd, indexRef) {
  useEffect(() => {
    if (!isVideo) return;
    const sub = player.addListener('playToEnd', () => {
      onEnd(indexRef.current + 1);
    });
    return () => sub.remove();
  }, [isVideo, player, onEnd, indexRef]);
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  media: {
    ...StyleSheet.absoluteFillObject,
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
    zIndex: 20,
  },
  segmentTrack: {
    height: 3,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.3)',
    overflow: 'hidden',
    flexGrow: 1,
  },
  segmentFill: {
    height: '100%',
    backgroundColor: '#fff',
    borderRadius: 2,
  },
  topBar: {
    position: 'absolute',
    top: 58,
    left: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'flex-start',
    zIndex: 10,
  },
  closeButton: {
    padding: 4,
    marginRight: 10,
  },
  metaContainer: {
    flex: 1,
  },
  metaText: {
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
    zIndex: 10,
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
