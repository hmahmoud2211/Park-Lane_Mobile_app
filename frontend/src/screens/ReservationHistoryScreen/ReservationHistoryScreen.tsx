import { useNavigation } from '@react-navigation/native';
import { useMemo, useState } from 'react';

import { AppText } from '../../components/common/AppText';
import { ChipGroup } from '../../components/parking/Controls';
import { Panel } from '../../components/parking/Panel';
import { ParkingButton } from '../../components/parking/ParkingButton';
import { ParkingFrame } from '../../components/parking/ParkingFrame';
import { ListRow } from '../../components/parking/Rows';
import { reservationIcon, reservationLines } from '../../components/parking/presenters';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useParking } from '../../hooks/useParking';
import { reservationView, residentReservations } from '../../services/parking/selectors';
import type { RootStackScreenProps } from '../../types/navigation.types';
import { filterOptions, historyCopy as copy, matchesFilter, type HistoryFilter } from './ReservationHistoryScreen.data';
import { createStyles } from './ReservationHistoryScreen.styles';

export function ReservationHistoryScreen() {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const navigation = useNavigation<RootStackScreenProps<'ReservationHistory'>['navigation']>();
  const { db, now, residentId } = useParking();
  const [filter, setFilter] = useState<HistoryFilter>('all');

  const all = useMemo(() => residentReservations(db, residentId), [db, residentId]);
  const shown = all.filter((r) => matchesFilter(r, filter)).map((r) => reservationView(db, r, now));
  const counts = filterOptions.map((o) => ({ ...o, label: `${o.label} (${all.filter((r) => matchesFilter(r, o.value)).length})` }));

  return (
    <ParkingFrame title={copy.title}>
      <ChipGroup scroll options={counts} value={filter} onChange={setFilter} />
      <Panel>
        {shown.length === 0 ? (
          <AppText variant="caption" color={theme.colors.textSecondary}>
            {copy.empty}
          </AppText>
        ) : (
          shown.map((view, index) => (
            <ListRow
              key={view.reservation.id}
              divided={index > 0}
              icon={reservationIcon(view)}
              title={`${view.title} · ${view.reservation.reference}`}
              lines={[...reservationLines(view), view.property.label]}
              statusLabel={view.status.label}
              statusTone={view.status.tone}
              onPress={() => navigation.navigate('ReservationDetails', { reservationId: view.reservation.id })}
            />
          ))
        )}
      </Panel>
      <AppText variant="label" color={theme.colors.textMuted} style={styles.summary}>
        Times are shown in Cairo time. Booked times and actual gate times are both kept for every visit.
      </AppText>
      <ParkingButton label="Reserve Guest Parking" icon="add-circle-outline" tone="primary" onPress={() => navigation.navigate('ReserveParking', { mode: 'guest' })} />
    </ParkingFrame>
  );
}
