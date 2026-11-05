import { useNavigation } from '@react-navigation/native';
import { useMemo, useState } from 'react';

import { AppText } from '../../components/common/AppText';
import { ChipGroup } from '../../features/parking/components/Controls';
import { Panel } from '../../features/parking/components/Panel';
import { ParkingButton } from '../../components/ui/ParkingButton';
import { ParkingFrame } from '../../features/parking/components/ParkingFrame';
import { ListRow } from '../../features/parking/components/Rows';
import { reservationIcon, reservationLines } from '../../features/parking/components/presenters';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useParking } from '../../features/parking/hooks/useParking';
import { reservationView, residentReservations } from '../../features/parking/services/selectors';
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
