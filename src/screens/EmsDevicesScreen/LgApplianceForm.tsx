import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { AppButton } from '../../components/common/AppButton';
import { AppInput } from '../../components/common/AppInput';
import { AppText } from '../../components/common/AppText';
import { FilterChip } from '../../components/ui/FilterChip';
import { useAppTheme } from '../../hooks/useAppTheme';
import { EmsError, listLgAppliances } from '../../services/ems/emsApi';
import type { LgAppliance } from '../../types/ems.types';
import { devicesCopy as copy } from './EmsDevicesScreen.data';
import { BUTTON_HEIGHT, FIELD_HEIGHT, SMALL_BUTTON_HEIGHT, createStyles } from './EmsDevicesScreen.styles';

export interface LgApplianceFormProps {
  /** Registers the appliance; throws EmsError with the backend's reason. */
  onAdd: (input: { name: string; room?: string; applianceId: string }) => Promise<unknown>;
  /** After the appliance was added. */
  onAdded: () => void;
  /** Opens the wizard that pairs a new AC with rethink from its setup hotspot. */
  onPairNew: () => void;
}

type Load =
  | { state: 'loading' }
  | { state: 'failed'; message: string }
  | { state: 'ready'; connected: boolean; appliances: LgAppliance[] };

/** Adds an LG appliance that rethink (the backend's local LG bridge) already knows, or pairs a new one. */
export function LgApplianceForm({ onAdd, onAdded, onPairNew }: LgApplianceFormProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [selected, setSelected] = useState<string | null>(null);
  const [name, setName] = useState<string>(copy.lgDefaultName);
  const [room, setRoom] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const fetchAppliances = useCallback(
    () =>
      listLgAppliances().then(
        (result) => {
          if (!mounted.current) {
            return;
          }
          setLoad({ state: 'ready', ...result });
          // One appliance not yet added is the obvious choice.
          const open = result.appliances.filter((appliance) => !appliance.added);
          setSelected((current) => current ?? (open.length === 1 ? open[0].id : null));
        },
        (caught: unknown) => {
          if (!mounted.current) {
            return;
          }
          setLoad({
            state: 'failed',
            message:
              caught instanceof EmsError && caught.code === 'not_configured'
                ? copy.lgNotConfigured
                : caught instanceof Error
                  ? caught.message
                  : copy.loadFailed,
          });
        },
      ),
    [],
  );

  useEffect(() => {
    void fetchAppliances();
  }, [fetchAppliances]);

  const refresh = useCallback(() => {
    setLoad({ state: 'loading' });
    void fetchAppliances();
  }, [fetchAppliances]);

  const submit = useCallback(async () => {
    if (!selected) {
      setError(copy.lgPickFirst);
      return;
    }
    if (!name.trim()) {
      setError(copy.lgNameMissing);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onAdd({ name: name.trim(), room: room.trim() || undefined, applianceId: selected });
      onAdded();
    } catch (caught) {
      setError(caught instanceof EmsError ? caught.message : 'The appliance could not be added.');
    } finally {
      setBusy(false);
    }
  }, [name, onAdd, onAdded, room, selected]);

  const refreshButton = (
    <AppButton title={copy.lgRefresh} variant="secondary" height={SMALL_BUTTON_HEIGHT} onPress={refresh} />
  );

  let body;
  if (load.state === 'loading') {
    body = (
      <View style={styles.toggleRow}>
        <AppText variant="tileCaption" color={theme.colors.textSupport}>
          {copy.lgLoading}
        </AppText>
        <ActivityIndicator color={theme.colors.textPrimary} />
      </View>
    );
  } else if (load.state === 'failed' || !load.connected || load.appliances.length === 0) {
    const message =
      load.state === 'failed' ? load.message : !load.connected ? copy.lgBridgeDown : copy.lgEmpty;
    body = (
      <>
        <AppText variant="tileCaption" color={load.state === 'failed' ? theme.colors.error : theme.colors.textSupport}>
          {message}
        </AppText>
        {load.state === 'ready' && load.connected ? (
          <AppButton title={copy.lgPairNew} variant="gradient" height={BUTTON_HEIGHT} onPress={onPairNew} />
        ) : null}
        {refreshButton}
      </>
    );
  } else {
    body = (
      <>
        <AppText variant="tileCaption" color={theme.colors.textSupport}>
          {copy.lgPick}
        </AppText>
        <View style={styles.chips} accessibilityRole="radiogroup">
          {load.appliances.map((appliance) => {
            const notes = [appliance.model, appliance.added && copy.lgAdded, !appliance.online && copy.lgOffline];
            return (
              <FilterChip
                key={appliance.id}
                role="radio"
                label={[appliance.name, ...notes].filter(Boolean).join(' · ')}
                iconSet="material"
                iconName="air-conditioner"
                selected={selected === appliance.id}
                onPress={() => setSelected(appliance.id)}
              />
            );
          })}
        </View>
        <AppInput variant="field" label={copy.name} value={name} onChangeText={setName} height={FIELD_HEIGHT} />
        <AppInput variant="field" label={copy.room} value={room} onChangeText={setRoom} height={FIELD_HEIGHT} />
        {error ? (
          <AppText variant="tileCaption" color={theme.colors.error} accessibilityRole="alert">
            {error}
          </AppText>
        ) : null}
        <AppButton
          title={copy.addLg}
          variant="gradient"
          height={BUTTON_HEIGHT}
          loading={busy}
          disabled={busy}
          onPress={() => void submit()}
        />
        <AppButton title={copy.lgPairNew} variant="secondary" height={SMALL_BUTTON_HEIGHT} onPress={onPairNew} />
      </>
    );
  }

  return (
    <View style={styles.form}>
      <AppText variant="bodySmall" color={theme.colors.textSupport}>
        {copy.lgNote}
      </AppText>
      {body}
    </View>
  );
}
