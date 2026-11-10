import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useState } from 'react';

import { deviceTimeOf } from '../../components/health/deviceTime';
import { Notice } from '../../components/parking/Notice';
import { ParkingButton } from '../../components/parking/ParkingButton';
import { useClinicQuery } from '../../hooks/useClinicQuery';
import { useHealth } from '../../hooks/useHealth';
import { reminderStatus, sendTestNotification } from '../../services/clinic/appointmentReminders';
import type { ReminderStatus, TestResult } from '../../services/clinic/appointmentReminders.shared';
import type { Appointment } from '../../services/clinic/clinic.types';
import { clinicApi } from '../../services/clinic/clinicApi';
import { clock } from '../../services/clinic/presenters';
import { reminderCopy } from './ClinicAppointmentScreen.data';

/**
 * Whether this device will remind the resident, read from the device: a
 * reminder that won't come says so. In testing (CLINIC_ANY_TIME_BOOKING) it
 * also offers this appointment's reminder in a few seconds.
 */
export function ReminderNotice({ appointment }: { appointment: Appointment }) {
  const { lang } = useHealth();
  const copy = reminderCopy[lang];
  const [status, setStatus] = useState<ReminderStatus | null>(null);
  const [test, setTest] = useState<TestResult | null>(null);
  const clinicConfig = useClinicQuery(useCallback(() => clinicApi.config(), []));
  const testing = clinicConfig.data?.any_time_booking === true;

  useFocusEffect(
    useCallback(() => {
      let current = true;
      void reminderStatus(appointment).then((value) => {
        if (current) setStatus(value);
      });
      return () => {
        current = false;
      };
    }, [appointment]),
  );

  if (!status || status.state === 'not_applicable') return null;

  const title =
    status.state === 'set' ? copy.set(clock(deviceTimeOf(status.at), lang)) : status.state === 'failed' ? copy.failed : copy[status.state];
  const tone = status.state === 'set' || status.state === 'phone_only' ? 'info' : status.state === 'failed' || status.state === 'denied' ? 'warning' : 'info';
  const testResult = test ? (test.state === 'failed' ? test.detail : test.state === 'sent' ? copy.testSent : copy.denied) : null;
  // One string: Notice only puts a plain string inside a text element.
  const detail = [status.state === 'failed' ? status.detail : status.state === 'set' && status.approximate ? copy.approximate : null, testResult].filter(Boolean).join(' ');

  return (
    <Notice
      tone={tone}
      title={title}
      actions={
        testing && status.state !== 'phone_only' ? (
          <ParkingButton
            compact
            icon="notifications-outline"
            label={copy.test}
            onPress={() => {
              setTest(null);
              void sendTestNotification(appointment, lang).then(setTest);
            }}
          />
        ) : undefined
      }
    >
      {detail || null}
    </Notice>
  );
}
