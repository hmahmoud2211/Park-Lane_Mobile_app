import { useNavigation, useRoute } from '@react-navigation/native';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { HealthFrame } from '../../components/health/HealthFrame';
import { ItemFields } from '../../components/health/ItemFields';
import { ErrorNotice, ResourceView } from '../../components/health/LoadState';
import { sectionIcon } from '../../components/health/presenters';
import { ChipGroup } from '../../components/parking/Controls';
import { Notice } from '../../components/parking/Notice';
import { Panel } from '../../components/parking/Panel';
import { ParkingButton } from '../../components/parking/ParkingButton';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useHealth } from '../../hooks/useHealth';
import { useHealthRecord } from '../../hooks/useHealthData';
import { RECORD_SECTIONS, type ItemData, type RecordItem, type RecordSection } from '../../services/health/health.types';
import { isHealthError, type HealthError } from '../../services/health/healthService';
import { dataFrom, draftFrom, emptyDraft, validateDraft, type Draft, type DraftErrors } from '../../services/health/itemForm';
import type { RootStackScreenProps } from '../../types/navigation.types';
import { itemFormCopy } from './HealthItemFormScreen.data';
import { createStyles } from './HealthItemFormScreen.styles';

/** Adds a record item by hand, or edits one, in any section. */
export function HealthItemFormScreen() {
  const { params } = useRoute<RootStackScreenProps<'HealthItemForm'>['route']>();
  const { lang } = useHealth();
  const copy = itemFormCopy[lang];
  const record = useHealthRecord(params.itemId ? params.profileId : null);

  if (!params.itemId) {
    return (
      <ItemForm
        profileId={params.profileId}
        initialSection={params.section ?? 'medications'}
        item={null}
        sectionFixed={params.section !== undefined}
        labTest={params.labTest}
      />
    );
  }
  const section = params.section ?? 'medications';
  const item = record.data ? (record.data[section] as RecordItem[]).find((entry) => entry.id === params.itemId) : undefined;
  if (item) {
    return <ItemForm key={item.id} profileId={params.profileId} initialSection={section} item={item} sectionFixed />;
  }
  return (
    <HealthFrame title={copy.addTitle}>
      <ResourceView resource={record}>{() => <Notice tone="info">{copy.notFound}</Notice>}</ResourceView>
    </HealthFrame>
  );
}

interface ItemFormProps {
  profileId: string;
  initialSection: RecordSection;
  item: RecordItem | null;
  sectionFixed: boolean;
  /** A new lab result for this test, e.g. from a "stale lab" nudge. */
  labTest?: string;
}

function ItemForm({ profileId, initialSection, item, sectionFixed, labTest }: ItemFormProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const navigation = useNavigation<RootStackScreenProps<'HealthItemForm'>['navigation']>();
  const { lang, t, saveItem } = useHealth();
  const copy = itemFormCopy[lang];

  const [section, setSection] = useState<RecordSection>(initialSection);
  const [draft, setDraft] = useState<Draft>(() => {
    if (item) return draftFrom(initialSection, item as never);
    const empty = emptyDraft(initialSection);
    return initialSection === 'labs' && labTest ? { ...empty, test: labTest } : empty;
  });
  const [errors, setErrors] = useState<DraftErrors>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<HealthError | null>(null);

  const chooseSection = (next: RecordSection) => {
    setSection(next);
    setDraft(emptyDraft(next));
    setErrors({});
  };

  const save = async () => {
    const found = validateDraft(section, draft);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    setError(null);
    try {
      const data = dataFrom(section, draft, item as ItemData<RecordSection> | null) as ItemData<RecordSection>;
      await saveItem(profileId, section, item?.id ?? null, data);
      navigation.goBack();
    } catch (caught) {
      if (isHealthError(caught)) setError(caught);
    } finally {
      setBusy(false);
    }
  };

  return (
    <HealthFrame
      title={item ? copy.editTitle(t.sections[section].one) : sectionFixed ? t.sections[section].add : copy.addTitle}
      subtitle={copy.subtitle}
      bottomBar={false}
      sideNav
      footer={<ParkingButton tone="primary" icon="checkmark" label={copy.save} loading={busy} onPress={() => void save()} />}
    >
      {sectionFixed ? null : (
        <ChipGroup
          label={copy.sectionLabel}
          options={RECORD_SECTIONS.map((value) => ({ value, label: t.sections[value].one, icon: sectionIcon[value] }))}
          value={section}
          onChange={chooseSection}
        />
      )}
      <Panel icon={sectionIcon[section]} title={t.sections[section].one}>
        <View style={styles.fields}>
          <ItemFields section={section} draft={draft} onChange={setDraft} errors={errors} />
        </View>
      </Panel>
      {error ? <ErrorNotice error={error} onRetry={() => void save()} /> : null}
    </HealthFrame>
  );
}
