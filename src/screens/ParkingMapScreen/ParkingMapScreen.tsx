import { useNavigation, useRoute } from '@react-navigation/native';
import { useMemo } from 'react';
import { View } from 'react-native';

import { AppText } from '../../components/common/AppText';
import { Notice } from '../../components/parking/Notice';
import { Panel } from '../../components/parking/Panel';
import { ParkingButton } from '../../components/parking/ParkingButton';
import { ParkingFrame } from '../../components/parking/ParkingFrame';
import { SiteMap } from '../../components/parking/site-map/SiteMap';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useParking } from '../../hooks/useParking';
import { gateNameIn, isLang, nameIn, type Lang } from '../../services/parking/i18n';
import { findInvitation, findReservation, gateMapsUrl } from '../../services/parking/selectors';
import type { RootStackScreenProps } from '../../types/navigation.types';
import { openExternal } from '../../utils/share';
import { mapCopy } from './ParkingMapScreen.data';
import { createStyles } from './ParkingMapScreen.styles';

/**
 * Gate-to-bay guidance: an external maps link for the drive to the right
 * vehicle entrance, then the site map with turn-by-turn steps for the way to
 * the exact bay, level by level. Opened from a visitor's pass, it shows
 * nobody else's parking.
 */
export function ParkingMapScreen() {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const navigation = useNavigation<RootStackScreenProps<'ParkingMap'>['navigation']>();
  const { params } = useRoute<RootStackScreenProps<'ParkingMap'>['route']>();
  const { db, now } = useParking();

  const visitor = Boolean(params.invite);
  // Residents and security read English; a guest keeps their pass's language.
  const lang: Lang = visitor && isLang(params.lang) ? params.lang : 'en';
  const copy = mapCopy[lang];
  const rtl = lang === 'ar';
  const reservation = visitor ? findInvitation(db, params.invite)?.reservation : findReservation(db, params.reservationId);
  const space = db.spaces.find((s) => s.id === (reservation?.spaceId ?? params.spaceId));
  const zone = db.zones.find((z) => z.id === space?.zoneId);
  const gate = db.gates.find((g) => g.id === space?.gateId);
  const frame = { title: copy.title, bottomBar: !visitor, showBack: !visitor || navigation.canGoBack(), rtl };

  if (!space || !zone || !gate) {
    return (
      <ParkingFrame {...frame}>
        <Notice tone="warning">{copy.notFound}</Notice>
      </ParkingFrame>
    );
  }

  return (
    <ParkingFrame {...frame}>
      <Panel
        title={`${space.label} · ${nameIn(zone.name, lang)}`}
        subtitle={`${nameIn(zone.level, lang)} · ${copy.enterBy(gateNameIn(gate.id, lang))}`}
        icon="map-outline"
        padded={false}
      >
        {/* The map guides by itself: the route glows and flows from the gate to the bay, then on foot. */}
        <View style={styles.mapPad}>
          <SiteMap db={db} now={now} mode="directions" targetSpaceId={space.id} privacy={visitor} lang={lang} />
        </View>
      </Panel>

      <ParkingButton
        label={copy.navigateTo(gateNameIn(gate.id, lang, true))}
        icon="navigate-outline"
        tone="primary"
        onPress={() => void openExternal(gateMapsUrl(gate))}
        accessibilityHint={copy.navigateHint}
      />

      <AppText variant="label" color={theme.colors.textMuted} style={styles.note}>
        {`${zone.indoor ? copy.gpsNote : copy.outdoorNote} ${copy.fictional}`}
      </AppText>
    </ParkingFrame>
  );
}
