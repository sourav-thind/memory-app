import { Image } from 'expo-image';
import * as DocumentPicker from 'expo-document-picker';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Plus, Video } from 'lucide-react-native';

import DropZoneUpload from '../components/DropZoneUpload';
import { supabase } from '../lib/supabase';
import { getThumbnailKey, resolveSnapMedia, resolveSnapUrl } from '../services/mediaService';
import { ingestZip } from '../services/uploadManager';
import { groupSnapsByMonthYear } from '../utils/groupSnaps';

const CELL_HEIGHTS = [150, 200, 240, 180, 220];

function getCellHeight(index) {
  return CELL_HEIGHTS[index % CELL_HEIGHTS.length];
}

function Thumbnail({ snap, index }) {
  const [uri, setUri] = useState(null);

  useEffect(() => {
    let active = true;
    resolveSnapUrl(getThumbnailKey(snap)).then(url => {
      if (active && url) setUri(url);
    });
    return () => { active = false; };
  }, [snap]);

  return (
    <View style={[styles.cell, { height: getCellHeight(index) }]}>
      {uri ? (
        <Image source={{ uri }} style={styles.thumb} contentFit="cover" transition={150} />
      ) : (
        <View style={styles.thumbPlaceholder}>
          <ActivityIndicator color="#888" size="small" />
        </View>
      )}

      {snap.media_type === 'video' ? (
        <View style={styles.videoBadge}>
          <Video color="#fff" size={16} fill="#fff" />
        </View>
      ) : null}
    </View>
  );
}

function GroupSection({ group, onPressSnap }) {
  const [columnA, columnB] = splitColumns(group.snaps);
  const renderCell = (snap, colIndex) => (
    <TouchableOpacity
      key={snap.id}
      activeOpacity={0.8}
      onPress={() => onPressSnap(group, colIndex)}
      style={styles.cellWrap}
    >
      <Thumbnail snap={snap} index={colIndex} />
    </TouchableOpacity>
  );

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{group.label}</Text>
      <View style={styles.masonryRow}>
        <View style={styles.column}>{columnA.map((snap) => renderCell(snap, snap.__colIndex))}</View>
        <View style={[styles.column, styles.columnGap]}>{columnB.map((snap) => renderCell(snap, snap.__colIndex))}</View>
      </View>
    </View>
  );
}

function splitColumns(snaps) {
  const colA = [];
  const colB = [];
  let sumA = 0;
  let sumB = 0;

  snaps.forEach((snap, i) => {
    const height = getCellHeight(i);
    const item = { ...snap, __colIndex: i };
    if (sumA <= sumB) {
      colA.push(item);
      sumA += height;
    } else {
      colB.push(item);
      sumB += height;
    }
  });

  return [colA, colB];
}

function formatRemaining(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  if (seconds < 60) return `${Math.ceil(seconds)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}m ${secs}s`;
}

function useMemoUploadEta(progress, startTime, active) {
  return useMemo(() => {
    if (!active || progress.phase !== 'uploading' || progress.total === 0) return '';
    const completed = Math.max(0, Math.min(progress.total, progress.completed));
    if (completed === 0 || !startTime) return '';
    const elapsed = Date.now() - startTime;
    const perUnit = elapsed / completed;
    const remainingMs = perUnit * (progress.total - completed);
    return formatRemaining(remainingMs / 1000);
  }, [active, progress, startTime]);
}

export default function MemoriesScreen({ navigation }) {
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({ phase: 'uploading', completed: 0, total: 0 });
  const [uploadStart, setUploadStart] = useState(0);
  const userRef = useRef(null);

  const loadSnaps = useCallback(async () => {
    try {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      userRef.current = user?.id || null;
      if (!user) {
        setGroups([]);
        return;
      }

      const { data, error } = await supabase
        .from('snaps')
        .select('*')
        .eq('user_id', user.id)
        .order('original_timestamp', { ascending: false });

      if (error) throw error;

      setGroups(groupSnapsByMonthYear(data || []));
    } catch (err) {
      Alert.alert('Error loading memories', err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSnaps();
  }, [loadSnaps]);

  const openStory = async (group, snapIndex) => {
    try {
      const enriched = await Promise.all(
        group.snaps.map(async snap => {
          const { mainUrl, overlayUrl } = await resolveSnapMedia(snap);
          return { ...snap, mainUrl, overlayUrl };
        })
      );

      navigation.navigate('StoryViewer', {
        snaps: enriched,
        startIndex: snapIndex,
      });
    } catch (err) {
      Alert.alert('Could not open story', err.message);
    }
  };

  const handleUploadComplete = async batch => {
    const added = batch?.succeeded?.length || 0;
    const failed = batch?.failed?.length || 0;
    if (added > 0) {
      Alert.alert('Upload complete', `${added} memories added.`);
    } else if (failed > 0) {
      Alert.alert('Upload finished with errors', `${failed} file(s) failed after retries.`);
    }
    await loadSnaps();
  };

  const handleUploadFailure = err => {
    Alert.alert('Upload failed', err.message);
  };

  const handleUpload = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/zip', 'application/x-zip-compressed', 'multipart/x-zip', '*/*'],
        copyToCacheDirectory: true,
        multiple: false,
      });

      if (result.canceled || !result.assets?.length) return;

      const asset = result.assets[0];
      setUploading(true);
      setUploadStart(Date.now());
      setUploadProgress({ phase: 'extracting', completed: 0, total: 1 });

      const { result: batch } = await ingestZip(asset.uri, {
        onProgress: payload => setUploadProgress(payload),
      });

      setUploading(false);
      const added = batch.succeeded.length;
      if (added > 0) {
        Alert.alert('Upload complete', `${added} memories added.`);
      } else if (batch.failed.length) {
        Alert.alert(
          'Upload finished with errors',
          `${batch.failed.length} file(s) failed after retries.`
        );
      }
      await loadSnaps();
    } catch (err) {
      setUploading(false);
      Alert.alert('Upload failed', err.message);
    }
  };

  const percent = uploadProgress.total
    ? Math.round(
        (Math.max(0, Math.min(uploadProgress.total, uploadProgress.completed)) /
          uploadProgress.total) *
          100
      )
    : 0;

  const etaText = useMemoUploadEta(uploadProgress, uploadStart, uploading);

  const emptyState = (
    <View style={styles.emptyWrap}>
      <View style={styles.emptyIllustration}>
        <Plus color="#fff" size={40} />
      </View>
      <Text style={styles.emptyTitle}>No memories yet</Text>
      <Text style={styles.emptySubtitle}>
        Your Snapchat Stories will appear here once you upload them.
      </Text>
      <TouchableOpacity style={styles.emptyCta} onPress={handleUpload} activeOpacity={0.85}>
        <Plus color="#111" size={20} style={styles.emptyCtaIcon} />
        <Text style={styles.emptyCtaText}>Upload your Snapchat Memories ZIP</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={styles.root}>
      <FlatList
        contentContainerStyle={styles.listContent}
        data={groups}
        keyExtractor={item => item.key}
        renderItem={({ item }) => <GroupSection group={item} onPressSnap={openStory} />}
        showsVerticalScrollIndicator={false}
        refreshing={loading}
        onRefresh={loadSnaps}
        ListEmptyComponent={loading ? null : emptyState}
      />

      <TouchableOpacity style={styles.fab} onPress={handleUpload} activeOpacity={0.85}>
        {uploading ? <ActivityIndicator color="#fff" /> : <Plus color="#fff" size={28} />}
      </TouchableOpacity>

      {/* Web/desktop drag-and-drop + progress modal */}
      <DropZoneUpload onComplete={handleUploadComplete} onError={handleUploadFailure} />

      {uploading ? (
        <View style={styles.uploadOverlay}>
          <View style={styles.uploadCard}>
            <Text style={styles.uploadOverlayTitle}>
              {uploadProgress.phase === 'extracting' ? 'Extracting memories…' : 'Uploading memories…'}
            </Text>
            <View style={styles.uploadTrack}>
              <View style={[styles.uploadFill, { width: `${percent}%` }]} />
            </View>
            <Text style={styles.uploadOverlayText}>{percent}%</Text>
            <Text style={styles.uploadOverlaySubtext}>
              {uploadProgress.currentFile
                ? `Uploading ${uploadProgress.currentFile === 'overlay' ? 'overlay' : 'main'} file`
                : `Completed ${uploadProgress.completed} / ${uploadProgress.total}`}
            </Text>
            {etaText ? <Text style={styles.uploadEta}>~{etaText} remaining</Text> : null}
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#fff',
  },
  listContent: {
    padding: 8,
    paddingBottom: 96,
  },
  section: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111',
    marginHorizontal: 4,
    marginBottom: 8,
    marginTop: 8,
  },
  masonryRow: {
    flexDirection: 'row',
  },
  column: {
    flex: 1,
  },
  columnGap: {
    marginLeft: 6,
  },
  cellWrap: {
    marginBottom: 6,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#f0f0f0',
  },
  cell: {
    width: '100%',
  },
  thumb: {
    flex: 1,
  },
  thumbPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoBadge: {
    position: 'absolute',
    right: 8,
    bottom: 8,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 12,
    padding: 6,
  },
  emptyWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingVertical: 80,
  },
  emptyIllustration: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#111',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111',
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 15,
    color: '#777',
    textAlign: 'center',
    marginBottom: 24,
    maxWidth: 320,
  },
  emptyCta: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#111',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 20,
  },
  emptyCtaIcon: {
    marginRight: 8,
  },
  emptyCtaText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 32,
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#111',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  uploadOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  uploadCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
  },
  uploadOverlayTitle: {
    color: '#111',
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 20,
  },
  uploadTrack: {
    width: '100%',
    height: 8,
    borderRadius: 4,
    backgroundColor: '#e6e6e6',
    overflow: 'hidden',
  },
  uploadFill: {
    height: '100%',
    backgroundColor: '#111',
    borderRadius: 4,
  },
  uploadOverlayText: {
    color: '#111',
    marginTop: 10,
    fontSize: 26,
    fontWeight: '800',
  },
  uploadOverlaySubtext: {
    color: '#555',
    marginTop: 6,
    fontSize: 14,
  },
  uploadEta: {
    color: '#999',
    marginTop: 4,
    fontSize: 13,
  },
});
