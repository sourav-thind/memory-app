import { Image } from 'expo-image';
import * as DocumentPicker from 'expo-document-picker';
import React, { useCallback, useEffect, useRef, useState } from 'react';
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

import { supabase } from '../lib/supabase';
import { getThumbnailKey, resolveSnapMedia, resolveSnapUrl } from '../services/mediaService';
import { uploadSnapsBatch } from '../services/uploadManager';
import { parseSnapchatZip } from '../utils/snapchatParser';
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

export default function MemoriesScreen({ navigation }) {
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({ completed: 0, total: 0 });
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
      setUploadProgress({ completed: 0, total: 0 });

      const parsed = await parseSnapchatZip(asset.uri);

      if (!parsed.length) {
        setUploading(false);
        Alert.alert('No memories found', 'No valid Snapchat media was found in that ZIP file.');
        return;
      }

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setUploading(false);
        Alert.alert('Not signed in', 'Please sign in to upload memories.');
        return;
      }

      await uploadSnapsBatch(parsed, user.id, (completed, total) => {
        setUploadProgress({ completed, total });
      });

      setUploading(false);
      Alert.alert('Upload complete', `${parsed.length} memories added.`);
      await loadSnaps();
    } catch (err) {
      setUploading(false);
      Alert.alert('Upload failed', err.message);
    }
  };

  const emptyState = (
    <View style={styles.center}>
      <Text style={styles.emptyTitle}>No memories yet</Text>
      <Text style={styles.emptySubtitle}>
        Tap the + button to import your Snapchat ZIP.
      </Text>
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

      {uploading ? (
        <View style={styles.uploadOverlay}>
          <ActivityIndicator color="#fff" size="large" />
          <Text style={styles.uploadOverlayText}>
            Importing memories… {uploadProgress.completed}/{uploadProgress.total}
          </Text>
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
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 15,
    color: '#777',
    textAlign: 'center',
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
  },
  uploadOverlayText: {
    color: '#fff',
    marginTop: 16,
    fontSize: 16,
    fontWeight: '600',
  },
});
