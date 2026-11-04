import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { useCallback, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useAppTheme } from '../../hooks/useAppTheme';
import type { AppTheme } from '../../types/theme.types';
import { AppText } from '../common/AppText';
import { Notice } from './Notice';
import { ParkingButton } from './ParkingButton';

export interface QrScannerProps {
  /** Called once per code; the scanner ignores repeats of the same code briefly. */
  onScan: (data: string) => void;
  onClose: () => void;
  /** What to do instead when the camera is refused; the gate console's fallbacks by default. */
  permissionHint?: string;
}

/** A code read again within this window is the same scan, not a new one. */
const REPEAT_WINDOW_MS = 3_000;
/** A share of the camera's maximum zoom: about 2x on most phones, for small printed codes. */
const ZOOMED_IN = 0.25;

/**
 * Camera QR scanning for the gate console, where the device allows it. If
 * permission is refused or there is no camera, the console's paste and
 * pick-a-pass options still work.
 */
export function QrScanner({
  onScan,
  onClose,
  permissionHint = 'Allow camera access to scan passes, or paste a code or pick a demo pass below.',
}: QrScannerProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [permission, requestPermission] = useCameraPermissions();
  const last = useRef<{ data: string; at: number } | null>(null);
  // Codes on appliance labels are small and often in shadow.
  const [torch, setTorch] = useState(false);
  const [zoomed, setZoomed] = useState(false);

  const handleScan = useCallback(
    ({ data }: BarcodeScanningResult) => {
      const now = Date.now();
      if (last.current && last.current.data === data && now - last.current.at < REPEAT_WINDOW_MS) {
        return;
      }
      last.current = { data, at: now };
      onScan(data);
    },
    [onScan],
  );

  if (!permission) {
    return <AppText variant="caption">Checking camera access…</AppText>;
  }

  if (!permission.granted) {
    return (
      <Notice
        tone="warning"
        title="Camera not available"
        actions={
          <>
            {permission.canAskAgain ? (
              <ParkingButton compact tone="primary" label="Allow camera" onPress={() => void requestPermission()} />
            ) : null}
            <ParkingButton compact label="Close" onPress={onClose} />
          </>
        }
      >
        {permissionHint}
      </Notice>
    );
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.camera}>
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={handleScan}
          enableTorch={torch}
          zoom={zoomed ? ZOOMED_IN : 0}
        />
        <View style={styles.frame} pointerEvents="none" />
      </View>
      <View style={styles.controls}>
        <ParkingButton
          compact
          label={torch ? 'Light off' : 'Light on'}
          icon={torch ? 'flashlight' : 'flashlight-outline'}
          onPress={() => setTorch((on) => !on)}
          style={styles.control}
        />
        <ParkingButton
          compact
          label={zoomed ? 'Zoom out' : 'Zoom in'}
          icon={zoomed ? 'remove-circle-outline' : 'add-circle-outline'}
          onPress={() => setZoomed((on) => !on)}
          style={styles.control}
        />
      </View>
      <ParkingButton compact label="Stop camera" icon="close-outline" onPress={onClose} />
    </View>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    wrap: {
      gap: 8,
    },
    controls: {
      flexDirection: 'row',
      gap: 8,
    },
    control: {
      flex: 1,
    },
    camera: {
      width: '100%',
      aspectRatio: 1,
      borderRadius: theme.borderRadius.md,
      overflow: 'hidden',
      backgroundColor: theme.colors.cameraFill,
    },
    frame: {
      position: 'absolute',
      top: '18%',
      left: '18%',
      width: '64%',
      aspectRatio: 1,
      borderRadius: theme.borderRadius.md,
      borderWidth: 2,
      borderColor: theme.colors.scanLine,
    },
  });
}
