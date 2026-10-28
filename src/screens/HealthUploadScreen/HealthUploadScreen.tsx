import Ionicons from '@expo/vector-icons/Ionicons';
import { useNavigation, useRoute } from '@react-navigation/native';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, Linking, Pressable, View } from 'react-native';

import { AppText } from '../../components/common/AppText';
import { DateField } from '../../components/health/DateField';
import { HealthFrame } from '../../components/health/HealthFrame';
import { ErrorNotice } from '../../components/health/LoadState';
import { ChipGroup } from '../../components/parking/Controls';
import { Notice } from '../../components/parking/Notice';
import { Panel } from '../../components/parking/Panel';
import { ParkingButton } from '../../components/parking/ParkingButton';
import { ProgressBar } from '../../components/ui/ProgressBar';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useHealth } from '../../hooks/useHealth';
import { DOCUMENT_TYPES, type DocumentType, type UploadFile } from '../../services/health/health.types';
import { isHealthError, uploadLimits, type HealthError } from '../../services/health/healthService';
import { isPdf, prepareDocument, prepareImage } from '../../services/health/prepareFiles';
import { checkDate } from '../../services/health/selectors';
import type { RootStackScreenProps } from '../../types/navigation.types';
import { cameraTips, uploadCopy } from './HealthUploadScreen.data';
import { createStyles } from './HealthUploadScreen.styles';

type Stage = 'pick' | 'tips' | 'preparing' | 'uploading' | 'done';

/**
 * Photographs or picks one document, readies it on the phone (HEIC to JPEG,
 * large photos scaled to 2500px, the 10 MB and 10 page limits) and uploads
 * it. The server then reads it in the background; the resident doesn't wait.
 */
export function HealthUploadScreen() {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const navigation = useNavigation<RootStackScreenProps<'HealthUpload'>['navigation']>();
  const { params } = useRoute<RootStackScreenProps<'HealthUpload'>['route']>();
  const { lang, t, upload, deleteDocument } = useHealth();
  const copy = uploadCopy[lang];

  const [stage, setStage] = useState<Stage>('pick');
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [type, setType] = useState<DocumentType | null>(params.type ?? null);
  const [date, setDate] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [dateError, setDateError] = useState<string | undefined>();
  const [error, setError] = useState<HealthError | null>(null);
  const [progress, setProgress] = useState(0);
  const [cameraBlocked, setCameraBlocked] = useState<{ canAskAgain: boolean } | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => () => abort.current?.abort(), []);

  const hasPdf = files.some(isPdf);
  const remaining = uploadLimits.maxPages - files.length;

  /** Checks and adds pages, reporting the first limit any of them breaks. */
  const addFiles = (incoming: UploadFile[]) => {
    const tooLarge = incoming.find((f) => f.size > uploadLimits.maxFileBytes);
    if (tooLarge) {
      setProblem(copy.errors.tooLarge(tooLarge.name));
      return;
    }
    const pdf = incoming.find(isPdf);
    if (pdf && (files.length > 0 || incoming.length > 1)) {
      setProblem(copy.pdfOnly);
      return;
    }
    if (files.length + incoming.length > uploadLimits.maxPages) {
      setProblem(copy.errors.tooManyPages);
      return;
    }
    setProblem(null);
    setFiles((current) => [...current, ...incoming]);
  };

  const prepare = async (run: () => Promise<UploadFile[]>) => {
    setStage('preparing');
    try {
      addFiles(await run());
    } catch {
      setProblem(copy.errors.prepareFailed);
    } finally {
      setStage('pick');
    }
  };

  const openCamera = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      setCameraBlocked({ canAskAgain: permission.canAskAgain });
      setStage('pick');
      return;
    }
    setCameraBlocked(null);
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 });
    if (result.canceled) {
      setStage('pick');
      return;
    }
    await prepare(() => Promise.all(result.assets.map((asset, i) => prepareImage(asset, files.length + i))));
  };

  const openGallery = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: remaining,
      quality: 1,
      // iOS hands over JPEG rather than HEIC where it can.
      preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
    });
    if (result.canceled) return;
    if (result.assets.length > remaining) {
      setProblem(copy.errors.tooManyPages);
      return;
    }
    await prepare(() => Promise.all(result.assets.map((asset, i) => prepareImage(asset, files.length + i))));
  };

  const openFiles = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: ['application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/heif'],
      multiple: true,
      copyToCacheDirectory: true,
    });
    if (result.canceled) return;
    const unsupported = result.assets.find((a) => !/^(image\/|application\/pdf)/.test(a.mimeType ?? '') && !/\.(pdf|jpe?g|png|heic|heif)$/i.test(a.name));
    if (unsupported) {
      setProblem(copy.errors.unsupported(unsupported.name));
      return;
    }
    await prepare(() =>
      Promise.all(
        result.assets.map((asset, i) =>
          isPdf({ mimeType: asset.mimeType ?? '', name: asset.name })
            ? prepareDocument(asset)
            : prepareImage({ uri: asset.uri, width: 0, height: 0, mimeType: asset.mimeType, fileName: asset.name, fileSize: asset.size }, files.length + i),
        ),
      ),
    );
  };

  const start = async () => {
    if (files.length === 0) {
      setProblem(copy.errors.noPages);
      return;
    }
    if (!type) {
      setProblem(copy.errors.noType);
      return;
    }
    const dateProblem = checkDate(date.trim());
    setDateError(dateProblem === 'format' ? copy.errors.dateFormat : dateProblem === 'future' ? copy.errors.dateFuture : undefined);
    if (dateProblem) return;

    setProblem(null);
    setError(null);
    setProgress(0);
    setStage('uploading');
    const controller = new AbortController();
    abort.current = controller;
    try {
      await upload(params.profileId, { files, type, document_date: date.trim() || null }, { onProgress: setProgress, signal: controller.signal });
      if (params.retryOf) {
        // The new upload replaces the one that couldn't be read.
        void deleteDocument({ id: params.retryOf, profile_id: params.profileId }, false).catch(() => undefined);
      }
      setStage('done');
    } catch (caught) {
      setStage('pick');
      if (isHealthError(caught) && caught.kind !== 'aborted') setError(caught);
    } finally {
      abort.current = null;
    }
  };

  if (stage === 'done') {
    return (
      <HealthFrame title={copy.title} bottomBar={false} sideNav footer={<ParkingButton tone="primary" label={copy.done} onPress={() => navigation.goBack()} />}>
        <Notice tone="success" title={copy.doneTitle}>
          {copy.doneBody}
        </Notice>
      </HealthFrame>
    );
  }

  const busy = stage === 'preparing' || stage === 'uploading';
  const footer =
    stage === 'uploading' ? (
      <View style={styles.footer}>
        <AppText variant="label" color={theme.colors.textSupport}>
          {copy.uploading(Math.round(progress * 100))}
        </AppText>
        <ProgressBar progress={progress} accessibilityLabel={copy.uploading(Math.round(progress * 100))} />
        <ParkingButton label={copy.cancel} icon="close" onPress={() => abort.current?.abort()} />
      </View>
    ) : (
      <ParkingButton tone="primary" icon="cloud-upload-outline" label={copy.upload} disabled={busy || files.length === 0} onPress={() => void start()} />
    );

  return (
    <HealthFrame title={copy.title} subtitle={params.retryOf ? copy.retrySubtitle : copy.subtitle} bottomBar={false} sideNav footer={footer}>
      {stage === 'tips' ? (
        <Panel icon="camera-outline" title={copy.tipsTitle}>
          <View style={styles.tips}>
            {cameraTips[lang].map((tip) => (
              <View key={tip.text} style={styles.tipRow}>
                <Ionicons name={tip.icon} size={20} color={theme.colors.accent} />
                <AppText variant="body" style={styles.tipText}>
                  {tip.text}
                </AppText>
              </View>
            ))}
          </View>
          <ParkingButton tone="primary" icon="camera" label={copy.openCamera} onPress={() => void openCamera()} />
          <ParkingButton label={t.actions.cancel} onPress={() => setStage('pick')} />
        </Panel>
      ) : (
        <Panel icon="add-circle-outline" title={files.length === 0 ? copy.sourceTitle : copy.addPage} subtitle={copy.filesHint}>
          {hasPdf ? (
            <AppText variant="caption" style={styles.muted}>
              {copy.pdfOnly}
            </AppText>
          ) : (
            <View style={styles.sources}>
              <ParkingButton icon="camera-outline" label={copy.camera} disabled={busy || remaining <= 0} onPress={() => setStage('tips')} />
              <ParkingButton icon="images-outline" label={copy.gallery} disabled={busy || remaining <= 0} onPress={() => void openGallery()} />
              {files.length === 0 ? (
                <ParkingButton icon="document-attach-outline" label={copy.files} disabled={busy} onPress={() => void openFiles()} />
              ) : null}
            </View>
          )}
        </Panel>
      )}

      {cameraBlocked ? (
        <Notice
          tone="warning"
          title={copy.permissionTitle}
          actions={
            cameraBlocked.canAskAgain ? (
              <ParkingButton compact tone="primary" label={copy.allow} onPress={() => void openCamera()} />
            ) : (
              <ParkingButton compact label={copy.openSettings} onPress={() => void Linking.openSettings()} />
            )
          }
        >
          {copy.permissionBody}
        </Notice>
      ) : null}

      {problem ? <Notice tone="warning">{problem}</Notice> : null}

      {stage === 'preparing' || files.length > 0 ? (
        <Panel icon="documents-outline" title={copy.pagesTitle(files.length)}>
          <View style={styles.pages}>
            {files.map((file, index) => (
              <View key={file.uri} style={styles.page}>
                <View style={styles.thumb}>
                  {isPdf(file) ? (
                    <Ionicons name="document-text-outline" size={32} color={theme.colors.textPrimary} />
                  ) : (
                    <Image source={{ uri: file.uri }} style={styles.thumbImage} resizeMode="cover" accessibilityIgnoresInvertColors />
                  )}
                  {!busy ? (
                    <Pressable
                      onPress={() => setFiles((current) => current.filter((f) => f.uri !== file.uri))}
                      accessibilityRole="button"
                      accessibilityLabel={copy.removePage(index + 1)}
                      hitSlop={6}
                      style={styles.remove}
                    >
                      <Ionicons name="close" size={18} color={theme.colors.textPrimary} />
                    </Pressable>
                  ) : null}
                </View>
                <AppText variant="label" color={theme.colors.textSupport} numberOfLines={1} style={styles.pageLabel}>
                  {isPdf(file) ? file.name : copy.pageLabel(index + 1)}
                </AppText>
              </View>
            ))}
            {stage === 'preparing' ? (
              <View style={[styles.thumb]} accessibilityLabel={copy.preparing}>
                <ActivityIndicator color={theme.colors.textPrimary} />
              </View>
            ) : null}
          </View>
        </Panel>
      ) : null}

      <Panel icon="pricetag-outline" title={copy.typeTitle}>
        <ChipGroup
          options={DOCUMENT_TYPES.map((value) => ({ value, label: t.documentType[value] }))}
          value={type}
          onChange={setType}
        />
        <DateField label={copy.dateLabel} value={date} onChange={setDate} hint={copy.dateHint} error={dateError} optional />
      </Panel>

      {error ? <ErrorNotice error={error} onRetry={() => void start()} /> : null}
    </HealthFrame>
  );
}
