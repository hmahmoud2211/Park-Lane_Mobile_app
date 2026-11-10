import { useCallback, useMemo } from 'react';
import { View } from 'react-native';

import { AppText } from '../../components/common/AppText';
import { ErrorNotice } from '../../components/feedback/ErrorNotice';
import { LoadingState } from '../../components/feedback/LoadingState';
import { Notice } from '../../components/feedback/Notice';
import { InnerScreenFrame } from '../../components/layout/InnerScreenFrame';
import { PageHeader } from '../../components/layout/PageHeader';
import { NeonPanel } from '../../components/ui/NeonPanel';
import { StatusChip } from '../../components/ui/StatusChip';
import { EmsError } from '../../features/ems/services/emsHttp';
import { day, egp } from '../../features/unitFinance/format';
import { getUnitCharges, getUnitPayments } from '../../features/unitFinance/services/unitApi';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useFocusQuery } from '../../hooks/useFocusQuery';
import { billsCopy as copy, methodLabel, statusLook } from './BillsScreen.data';
import { createStyles } from './BillsScreen.styles';

/**
 * Bills & Utilities: the apartment's service charges and utility bills with what is left on each, and the payments
 * building management recorded (paid at the office or by transfer; never in the app). The owner's view.
 */
export function BillsScreen() {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const fetchBills = useCallback(async () => {
    const [bills, payments] = await Promise.all([getUnitCharges('bills'), getUnitPayments()]);
    return { bills, payments };
  }, []);
  const query = useFocusQuery(fetchBills);

  const body = () => {
    if (query.error instanceof EmsError && query.error.code === 'forbidden') {
      return (
        <Notice tone="info" title={copy.memberTitle}>
          {copy.memberBody}
        </Notice>
      );
    }
    if (query.error?.code === 'no_home') {
      return (
        <Notice tone="info" title={copy.noHomeTitle}>
          {copy.noHomeBody}
        </Notice>
      );
    }
    if (query.error) {
      return (
        <ErrorNotice title={copy.loadFailed} retryLabel={copy.retry} onRetry={query.reload}>
          {query.error.message}
        </ErrorNotice>
      );
    }
    if (!query.data) return <LoadingState />;
    const { bills, payments } = query.data;
    return (
      <>
        <NeonPanel style={styles.panel}>
          <AppText variant="bodyStrong" accessibilityRole="header">
            {copy.billsHeading}
          </AppText>
          {bills.length === 0 ? (
            <AppText variant="bodySmall" color={theme.colors.textSecondary}>
              {copy.noBills}
            </AppText>
          ) : (
            bills.map((bill) => (
              <View key={bill.id} style={styles.row}>
                <View style={styles.rowText}>
                  <AppText variant="bodyStrong">{bill.title}</AppText>
                  <AppText variant="caption" color={theme.colors.textSupport}>
                    {`${copy.due(day(bill.dueOn))} · ${bill.reference}`}
                  </AppText>
                </View>
                <View style={styles.amount}>
                  <AppText variant="bodyStrong">{egp(bill.amount)}</AppText>
                  {bill.status === 'partial' || bill.status === 'overdue' ? (
                    <AppText variant="caption" color={theme.colors.textSupport}>
                      {copy.left(egp(bill.outstanding))}
                    </AppText>
                  ) : null}
                  <StatusChip label={statusLook[bill.status].label} tone={statusLook[bill.status].tone} />
                </View>
              </View>
            ))
          )}
          <AppText variant="caption" color={theme.colors.textSecondary}>
            {copy.howToPay}
          </AppText>
        </NeonPanel>

        <NeonPanel style={styles.panel}>
          <AppText variant="bodyStrong" accessibilityRole="header">
            {copy.paymentsHeading}
          </AppText>
          {payments.length === 0 ? (
            <AppText variant="bodySmall" color={theme.colors.textSecondary}>
              {copy.noPayments}
            </AppText>
          ) : (
            payments.map((payment) => (
              <View key={payment.id} style={styles.row}>
                <View style={styles.rowText}>
                  <AppText variant="bodyStrong">{payment.chargeTitle ?? methodLabel[payment.method]}</AppText>
                  <AppText variant="caption" color={theme.colors.textSupport}>
                    {`${day(payment.paidOn)} · ${methodLabel[payment.method]} · ${payment.receiptNo}`}
                  </AppText>
                </View>
                <AppText variant="bodyStrong">{egp(payment.amount)}</AppText>
              </View>
            ))
          )}
        </NeonPanel>
      </>
    );
  };

  return (
    <InnerScreenFrame contentStyle={styles.content}>
      <PageHeader title={copy.title} subtitle={copy.subtitle} style={styles.header} />
      {body()}
    </InnerScreenFrame>
  );
}
