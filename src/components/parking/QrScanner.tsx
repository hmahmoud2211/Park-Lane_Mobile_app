import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { useCallback, useMemo, useRef } from 'react';
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
}

/** A code read again within this window is the same scan, not a new one. */
const REPEAT_WINDOW_MS = 3_000;

/**
 * Camera QR scanning for the gate console, where the device allows it. If
 * permission is refused or there is no camera, the console's paste and
 * pick-a-pass options still work.
 */
export function QrScanner({ onScan, onClose }: QrScannerProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [permission, requestPermission] = useCameraPermissions();
  const last = useRef<{ data: string; at: number } | null>(null);

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
        Allow camera access to scan passes, or paste a code or pick a demo pass below.
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
        />
        <View style={styles.frame} pointerEvents="none" />
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
