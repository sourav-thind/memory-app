import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { UploadCloud, FileArchive } from 'lucide-react-native';

import { ingestZip } from '../services/uploadManager';

function formatRemaining(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  if (seconds < 60) return `${Math.ceil(seconds)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}m ${secs}s`;
}

const ACCEPTED_TYPES = [
  'application/zip',
  'application/x-zip-compressed',
  'multipart/x-zip',
  'application/x-compressed',
];

function looksLikeZip(file) {
  return (
    file.name?.toLowerCase().endsWith('.zip') ||
    (file.type && ACCEPTED_TYPES.includes(file.type.toLowerCase()))
  );
}

export default function DropZoneUpload({ onComplete, onError }) {
  const isWeb = Platform.OS === 'web';
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ phase: 'uploading', completed: 0, total: 0 });
  const [currentFile, setCurrentFile] = useState(null);
  const startRef = useRef(0);
  const dragDepth = useRef(0);

  const handleFiles = useCallback(
    async files => {
      const file = Array.from(files || []).find(looksLikeZip);
      if (!file) {
        Alert.alert('No ZIP file', 'Please drop a Snapchat Memories `.zip` archive.');
        return;
      }

      setBusy(true);
      setCurrentFile(null);
      startRef.current = Date.now();
      setProgress({ phase: 'extracting', completed: 0, total: 1 });

      const handleProgress = payload => {
        setProgress(payload);
        setCurrentFile(
          payload.phase === 'uploading' && payload.currentFile
            ? { file: payload.currentFile, baseId: payload.snap_base_id }
            : null
        );
      };

      try {
        const { result } = await ingestZip(file, {
          onProgress: handleProgress,
        });
        if (onComplete) onComplete(result);
      } catch (err) {
        if (onError) onError(err);
        else Alert.alert('Upload failed', err.message);
      } finally {
        setBusy(false);
        setCurrentFile(null);
        startRef.current = 0;
        setProgress({ phase: 'uploading', completed: 0, total: 0 });
      }
    },
    [onComplete, onError]
  );

  useEffect(() => {
    if (!isWeb || typeof window === 'undefined') return;

    const prevent = e => {
      e.preventDefault();
      e.stopPropagation();
      setDragging(true);
    };
    const leave = e => {
      e.preventDefault();
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragging(false);
    };
    const enter = e => {
      e.preventDefault();
      dragDepth.current += 1;
      setDragging(true);
    };
    const drop = e => {
      e.preventDefault();
      e.stopPropagation();
      dragDepth.current = 0;
      setDragging(false);
      handleFiles(e.dataTransfer?.files);
    };

    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', prevent);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    document.addEventListener('drop', prevent);

    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', prevent);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
      document.removeEventListener('drop', prevent);
    };
  }, [isWeb, handleFiles]);

  const completed = Math.max(0, Math.min(progress.total, progress.completed));
  const percentage = progress.total ? Math.round((completed / progress.total) * 100) : 0;

  const remainingSeconds = useMemo(() => {
    if (!busy || completed === 0) return null;
    const elapsed = Date.now() - startRef.current;
    const perUnit = elapsed / completed;
    return perUnit * (progress.total - completed) / 1000;
  }, [busy, completed, progress.total]);

  if (!isWeb) return null;

  return (
    <>
      {dragging && !busy ? (
        <View style={styles.dropOverlay} pointerEvents="none">
          <View style={styles.dropBox}>
            <FileArchive color="#fff" size={40} />
            <Text style={styles.dropTitle}>Drop your ZIP to upload</Text>
            <Text style={styles.dropSubtitle}>Snapchat Memories archive</Text>
          </View>
        </View>
      ) : null}

      <Modal visible={busy} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            {progress.phase === 'extracting' ? (
              <Text style={styles.modalTitle}>Extracting memories…</Text>
            ) : (
              <Text style={styles.modalTitle}>Uploading memories…</Text>
            )}

            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${percentage}%` }]} />
            </View>
            <Text style={styles.percentText}>{percentage}%</Text>

            <Text style={styles.detailText}>
              {currentFile
                ? `Uploading ${currentFile.file === 'overlay' ? 'overlay' : 'main'} file`
                : `Completed ${completed} / ${progress.total}`}
            </Text>
            <Text style={styles.etaText}>
              {remainingSeconds ? `~${formatRemaining(remainingSeconds)} remaining` : ' '}
            </Text>

            <View style={styles.uploadingRow}>
              <UploadCloud color="#888" size={18} />
              <ActivityIndicator color="#888" size="small" style={{ marginLeft: 8 }} />
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  dropOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1000,
    backgroundColor: 'rgba(17,17,17,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dropBox: {
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: '#fff',
    borderRadius: 16,
    paddingVertical: 48,
    paddingHorizontal: 40,
    alignItems: 'center',
  },
  dropTitle: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '700',
    marginTop: 16,
  },
  dropSubtitle: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 15,
    marginTop: 6,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111',
    marginBottom: 20,
  },
  progressTrack: {
    width: '100%',
    height: 8,
    borderRadius: 4,
    backgroundColor: '#e6e6e6',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#111',
    borderRadius: 4,
  },
  percentText: {
    fontSize: 28,
    fontWeight: '800',
    color: '#111',
    marginTop: 10,
  },
  detailText: {
    fontSize: 15,
    color: '#555',
    marginTop: 8,
    textAlign: 'center',
  },
  etaText: {
    fontSize: 13,
    color: '#999',
    marginTop: 4,
    minHeight: 18,
  },
  uploadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 16,
  },
});
