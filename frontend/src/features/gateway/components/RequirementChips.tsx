import { StyleSheet, View } from 'react-native';

import type { Brand, Candidate, ConnectionMethod, SupportLevel } from '../../../types/gateway.types';
import { StatusChip, type StatusTone } from '../../../components/ui/StatusChip';

/** What a brand, connection method or found device needs, as chips: account, keys, approval, support level. */

const SUPPORT: Record<SupportLevel, { label: string; tone: StatusTone } | null> = {
  supported: null,
  limited: { label: 'Some models', tone: 'amber' },
  experimental: { label: 'Experimental', tone: 'amber' },
  unsupported: { label: 'Not available', tone: 'slate' },
};

export function SupportChip({ status }: { status: SupportLevel }) {
  const look = SUPPORT[status];
  return look ? <StatusChip label={look.label} tone={look.tone} icon={status === 'experimental' ? 'flask-outline' : undefined} /> : null;
}

/** How a brand connects, on its tile in Add Device. */
export function BrandChips({ brand }: { brand: Brand }) {
  if (brand.needs_home_gateway) {
    return <StatusChip label="Needs a box at home" tone="slate" icon="home-outline" />;
  }
  return (
    <>
      <SupportChip status={brand.status} />
      {brand.adapters.length === 0 ? (
        <StatusChip label="Brand account needed" tone="amber" icon="person-outline" />
      ) : brand.account_free ? (
        <StatusChip label="No account needed" tone="teal" icon="lock-open-outline" />
      ) : null}
    </>
  );
}

export function MethodChips({ method }: { method: ConnectionMethod }) {
  return (
    <View style={styles.row}>
      <SupportChip status={method.status} />
      {method.manufacturer_account ? (
        <StatusChip label="Brand account needed" tone="amber" icon="person-outline" />
      ) : method.available ? (
        <StatusChip label="No account needed" tone="teal" icon="lock-open-outline" />
      ) : null}
      {method.local_key ? <StatusChip label="Local key needed" tone="indigo" icon="key-outline" /> : null}
      {method.user_approval ? <StatusChip label="Approve on device" tone="indigo" icon="hand-left-outline" /> : null}
      {method.hotspot_password === 'verified_rule' ? <StatusChip label="Known setup password" tone="teal" icon="wifi-outline" /> : null}
      {method.hotspot_password === 'user' ? <StatusChip label="Setup password needed" tone="indigo" icon="wifi-outline" /> : null}
      {method.transport === 'gateway' ? <StatusChip label="Uses the gateway’s Wi-Fi" tone="slate" icon="hardware-chip-outline" /> : null}
    </View>
  );
}

const AUTH_LABELS: Record<string, string> = {
  approve_on_device: 'Approve on device',
  pin: 'PIN from device',
  local_key: 'Local key needed',
  device_credentials: 'Device password',
  account_credentials: 'Brand account login',
};

export function CandidateChips({ candidate }: { candidate: Candidate }) {
  const auth = AUTH_LABELS[candidate.pairing.auth];
  return (
    <View style={styles.row}>
      {candidate.paired_device_id ? <StatusChip label="Already added" tone="teal" icon="checkmark-outline" /> : null}
      {candidate.control === 'detection_only' ? (
        <StatusChip label="Detected only" tone="slate" icon="eye-outline" />
      ) : candidate.control === 'experimental' ? (
        <StatusChip label="Experimental" tone="amber" icon="flask-outline" />
      ) : (
        <StatusChip label="Local control" tone="teal" icon="wifi-outline" />
      )}
      {candidate.account_free ? null : <StatusChip label="Brand account needed" tone="amber" icon="person-outline" />}
      {auth ? <StatusChip label={auth} tone="indigo" icon="key-outline" /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
});
