import { useNavigation, useRoute } from '@react-navigation/native';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { AppText } from '../../components/common/AppText';
import { ConfirmSheet } from '../../components/health/ConfirmSheet';
import { HealthFrame } from '../../components/health/HealthFrame';
import { ItemRow } from '../../components/health/ItemRow';
import { ResourceView } from '../../components/health/LoadState';
import { documentIcon, documentLines, sectionIcon, statusTone } from '../../components/health/presenters';
import { Sparkline } from '../../components/health/Sparkline';
import { ChipGroup } from '../../components/parking/Controls';
import { Panel } from '../../components/parking/Panel';
import { ParkingButton } from '../../components/parking/ParkingButton';
import { ListRow } from '../../components/parking/Rows';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useHealth } from '../../hooks/useHealth';
import { useHealthDocuments, useHealthRecord } from '../../hooks/useHealthData';
import type { HealthDocument, HealthRecord, LabResult, RecordItem, RecordSection } from '../../services/health/health.types';
import { formatDate, num } from '../../services/health/i18n';
import { describeItem, groupLabs, labFlag, rangeText, splitMedications } from '../../services/health/selectors';
import type { RecordTab, RootStackScreenProps } from '../../types/navigation.types';
import { RECORD_TABS, TREND_MIN_RESULTS, recordsCopy } from './HealthRecordsScreen.data';
import { createStyles } from './HealthRecordsScreen.styles';

type Navigation = RootStackScreenProps<'HealthRecords'>['navigation'];

interface PendingDelete {
  section: RecordSection;
  id: string;
  title: string;
}

/** Every section of one profile's record, item by item, with where each came from. */
export function HealthRecordsScreen() {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const navigation = useNavigation<Navigation>();
  const { params } = useRoute<RootStackScreenProps<'HealthRecords'>['route']>();
  const { lang, t, deleteItem } = useHealth();
  const copy = recordsCopy[lang];
  const { profileId } = params;
  const [tab, setTab] = useState<RecordTab>(params.tab ?? 'allergies');
  const [pending, setPending] = useState<PendingDelete | null>(null);
  const record = useHealthRecord(profileId);
  const documents = useHealthDocuments(profileId);

  const docsById = useMemo(
    () => new Map((documents.data ?? []).map((doc) => [doc.id, doc] as const)),
    [documents.data],
  );

  const tabLabel = (value: RecordTab) => (value === 'documents' ? t.documentsTab : t.sections[value].title);

  const source = (sourceId: string | null) => {
    if (sourceId === null) return { sourceLabel: t.sourceManual };
    const doc = docsById.get(sourceId);
    return {
      sourceLabel: doc
        ? t.sourceDocument(t.documentType[doc.type], formatDate(doc.document_date ?? doc.uploaded_at, lang))
        : copy.unknownDocument,
      onSourcePress: () => navigation.navigate('HealthDocument', { docId: sourceId }),
    };
  };

  const editProps = (section: RecordSection, item: RecordItem, title: string) => ({
    onEdit: () => navigation.navigate('HealthItemForm', { profileId, section, itemId: item.id }),
    onDelete: () => setPending({ section, id: item.id, title }),
  });

  const row = (section: Exclude<RecordSection, 'labs'>, item: RecordItem, index: number) => {
    const summary = describeItem(section, item as never, lang);
    const severe = section === 'allergies' && (item as HealthRecord['allergies'][number]).severity === 'severe';
    return (
      <ItemRow
        key={item.id}
        divided={index > 0}
        icon={sectionIcon[section]}
        summary={severe ? { ...summary, emphasis: undefined } : summary}
        flag={severe ? { label: t.severity.severe, tone: 'red' } : undefined}
        {...source(item.source)}
        {...editProps(section, item, summary.title)}
      />
    );
  };

  const addButton = (section: RecordSection) => (
    <ParkingButton
      compact
      icon="add"
      label={t.sections[section].add}
      onPress={() => navigation.navigate('HealthItemForm', { profileId, section })}
    />
  );

  const emptyLine = (text: string) => (
    <AppText variant="caption" style={styles.empty}>
      {text}
    </AppText>
  );

  const labRow = (lab: LabResult, index: number) => {
    const flag = labFlag(lab);
    return (
      <ItemRow
        key={lab.id}
        divided={index > 0}
        icon="flask-outline"
        summary={{
          title: formatDate(lab.date, lang),
          emphasis: [num(lab.value, lang), lab.unit].filter(Boolean).join(' '),
          lines: [rangeText(lab, lang)].filter(Boolean),
        }}
        flag={flag ? { label: flag === 'high' ? t.aboveRange : t.belowRange, tone: 'red' } : undefined}
        {...source(lab.source)}
        {...editProps('labs', lab, lab.test)}
      />
    );
  };

  const sectionContent = (rec: HealthRecord, section: RecordSection) => {
    if (section === 'labs') {
      const groups = groupLabs(rec.labs);
      return (
        <>
          {groups.length === 0 ? <Panel>{emptyLine(t.sections.labs.empty)}</Panel> : null}
          {groups.map((group) => (
            <Panel
              key={group.test}
              icon="flask-outline"
              title={group.test}
              subtitle={copy.results(group.results.length)}
              trailing={
                group.results.length >= TREND_MIN_RESULTS ? (
                  <Sparkline
                    values={[...group.results].reverse().map((r) => r.value)}
                    refHigh={group.results[0].ref_high}
                    accessibilityLabel={copy.trend(group.test)}
                  />
                ) : undefined
              }
            >
              <View>{group.results.map(labRow)}</View>
            </Panel>
          ))}
          {addButton('labs')}
        </>
      );
    }
    if (section === 'medications') {
      const { current, past } = splitMedications(rec.medications);
      return (
        <>
          <Panel icon="medical-outline" title={t.current}>
            {current.length === 0 ? emptyLine(t.sections.medications.empty) : <View>{current.map((m, i) => row('medications', m, i))}</View>}
          </Panel>
          {past.length > 0 ? (
            <Panel icon="time-outline" title={t.past}>
              <View>{past.map((m, i) => row('medications', m, i))}</View>
            </Panel>
          ) : null}
          {addButton('medications')}
        </>
      );
    }
    const items = rec[section] as RecordItem[];
    const sorted =
      section === 'visits' || section === 'procedures'
        ? [...items].sort((a, b) => String((b as { date?: string }).date ?? '').localeCompare(String((a as { date?: string }).date ?? '')))
        : items;
    return (
      <>
        <Panel icon={sectionIcon[section]} title={t.sections[section].title}>
          {sorted.length === 0 ? emptyLine(t.sections[section].empty) : <View>{sorted.map((item, i) => row(section, item, i))}</View>}
        </Panel>
        {addButton(section)}
      </>
    );
  };

  const documentsContent = (docs: HealthDocument[]) => (
    <>
      <Panel icon="folder-open-outline" title={t.documentsTab}>
        {docs.length === 0
          ? emptyLine(copy.noDocuments)
          : docs.map((doc, index) => (
              <ListRow
                key={doc.id}
                divided={index > 0}
                icon={documentIcon[doc.type]}
                title={t.documentType[doc.type]}
                lines={documentLines(doc, lang)}
                statusLabel={t.documentStatus[doc.status]}
                statusTone={statusTone[doc.status]}
                onPress={() =>
                  navigation.navigate(doc.status === 'needs_review' ? 'HealthReview' : 'HealthDocument', { docId: doc.id })
                }
              />
            ))}
      </Panel>
      <ParkingButton
        tone="primary"
        icon="cloud-upload-outline"
        label={copy.upload}
        onPress={() => navigation.navigate('HealthUpload', { profileId })}
      />
    </>
  );

  return (
    <HealthFrame title={record.data?.patient.name ?? copy.title} subtitle={copy.title}>
      <ChipGroup
        scroll
        label={copy.tabsLabel}
        options={RECORD_TABS.map((value) => ({ value, label: tabLabel(value) }))}
        value={tab}
        onChange={setTab}
      />
      {tab === 'documents' ? (
        <ResourceView resource={documents}>{documentsContent}</ResourceView>
      ) : (
        <ResourceView resource={record}>{(rec) => sectionContent(rec, tab)}</ResourceView>
      )}
      <ConfirmSheet
        visible={pending !== null}
        title={pending ? copy.deleteTitle(pending.title) : ''}
        body={copy.deleteBody}
        options={[{ id: 'delete', label: t.actions.delete, tone: 'danger', icon: 'trash-outline' }]}
        onSelect={async () => {
          if (!pending) return;
          await deleteItem(profileId, pending.section, pending.id);
          setPending(null);
        }}
        onClose={() => setPending(null)}
      />
    </HealthFrame>
  );
}
