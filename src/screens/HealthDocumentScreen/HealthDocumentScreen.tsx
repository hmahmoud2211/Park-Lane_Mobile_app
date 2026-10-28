import { useNavigation, useRoute } from '@react-navigation/native';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { AppText } from '../../components/common/AppText';
import { BidiText } from '../../components/health/BidiText';
import { ConfirmSheet } from '../../components/health/ConfirmSheet';
import { HealthFrame } from '../../components/health/HealthFrame';
import { ItemRow } from '../../components/health/ItemRow';
import { ResourceView } from '../../components/health/LoadState';
import { OriginalFile } from '../../components/health/OriginalFile';
import { sectionIcon, statusTone } from '../../components/health/presenters';
import { FactGrid } from '../../components/parking/Controls';
import { Notice } from '../../components/parking/Notice';
import { Panel } from '../../components/parking/Panel';
import { ParkingButton } from '../../components/parking/ParkingButton';
import { StatusChip } from '../../components/ui/StatusChip';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useHealth } from '../../hooks/useHealth';
import { useHealthDocument, useHealthRecord, useHealthState } from '../../hooks/useHealthData';
import type { HealthDocument } from '../../services/health/health.types';
import { formatDate, num } from '../../services/health/i18n';
import { describeItem, itemsFromDocument } from '../../services/health/selectors';
import type { RootStackScreenProps } from '../../types/navigation.types';
import { copyText } from '../../utils/share';
import { documentCopy } from './HealthDocumentScreen.data';
import { createStyles } from './HealthDocumentScreen.styles';

type Navigation = RootStackScreenProps<'HealthDocument'>['navigation'];

/**
 * One uploaded document: its status, the original (while the backend still
 * keeps it), the full text read from it, and the record items it produced.
 */
export function HealthDocumentScreen() {
  const { params } = useRoute<RootStackScreenProps<'HealthDocument'>['route']>();
  const { t } = useHealth();
  const doc = useHealthDocument(params.docId);
  return doc.data ? (
    <DocumentDetail doc={doc.data} />
  ) : (
    <HealthFrame title={t.documentsTab}>
      <ResourceView resource={doc}>{() => null}</ResourceView>
    </HealthFrame>
  );
}

function DocumentDetail({ doc }: { doc: HealthDocument }) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const navigation = useNavigation<Navigation>();
  const { lang, t, deleteDocument, recheckDocument } = useHealth();
  const copy = documentCopy[lang];
  const record = useHealthRecord(doc.profile_id);
  const { slowJobs } = useHealthState();
  const [confirming, setConfirming] = useState(false);
  const [copied, setCopied] = useState(false);

  const saved = record.data ? itemsFromDocument(record.data, doc.id) : [];

  const status = () => {
    switch (doc.status) {
      case 'processing':
        return slowJobs.includes(doc.id) ? (
          <Notice
            tone="warning"
            title={copy.slowTitle}
            actions={<ParkingButton compact icon="refresh" label={copy.checkAgain} onPress={() => recheckDocument(doc.id)} />}
          >
            {copy.slowBody}
          </Notice>
        ) : (
          <Notice tone="info" title={copy.processingTitle}>
            {copy.processingBody}
          </Notice>
        );
      case 'needs_review':
        return (
          <Notice
            tone="warning"
            title={copy.reviewTitle}
            actions={
              <ParkingButton
                compact
                tone="primary"
                icon="checkmark-done-outline"
                label={copy.review}
                onPress={() => navigation.replace('HealthReview', { docId: doc.id })}
              />
            }
          >
            {copy.reviewBody}
          </Notice>
        );
      case 'failed':
        return (
          <Notice
            tone="error"
            title={copy.failedTitle}
            actions={
              <>
                <ParkingButton
                  compact
                  tone="primary"
                  icon="camera-outline"
                  label={copy.tryAgain}
                  onPress={() => navigation.navigate('HealthUpload', { profileId: doc.profile_id, type: doc.type, retryOf: doc.id })}
                />
                <ParkingButton
                  compact
                  icon="create-outline"
                  label={copy.addManually}
                  onPress={() => navigation.navigate('HealthItemForm', { profileId: doc.profile_id })}
                />
              </>
            }
          >
            {doc.error ?? t.errors.server.body}
          </Notice>
        );
      case 'confirmed':
        return null;
    }
  };

  return (
    <HealthFrame
      title={t.documentType[doc.type]}
      subtitle={formatDate(doc.document_date ?? doc.uploaded_at, lang)}
      aside={
        <>
          {doc.extracted_text ? (
            <Panel icon="reader-outline" title={copy.extractedText} subtitle={copy.extractedHint}>
              <View style={styles.textBox}>
                <BidiText variant="caption" selectable>
                  {doc.extracted_text}
                </BidiText>
              </View>
              <ParkingButton
                compact
                icon={copied ? 'checkmark' : 'copy-outline'}
                label={copied ? copy.copied : copy.copy}
                onPress={() => {
                  void copyText(doc.extracted_text ?? '').then((ok) => setCopied(ok));
                }}
              />
            </Panel>
          ) : null}
          {doc.status === 'confirmed' || saved.length > 0 ? (
            <Panel icon="checkmark-circle-outline" title={copy.savedItems}>
              {saved.length === 0 ? (
                <AppText variant="caption" style={styles.muted}>
                  {copy.noSavedItems}
                </AppText>
              ) : (
                <View>
                  {saved.map(({ section, item }, index) => (
                    <ItemRow
                      key={item.id}
                      divided={index > 0}
                      icon={sectionIcon[section]}
                      summary={describeItem(section, item as never, lang)}
                      onEdit={() =>
                        navigation.navigate('HealthItemForm', { profileId: doc.profile_id, section, itemId: item.id })
                      }
                    />
                  ))}
                </View>
              )}
            </Panel>
          ) : null}
          <ParkingButton tone="danger" icon="trash-outline" label={copy.delete} onPress={() => setConfirming(true)} />
        </>
      }
    >
      <Panel trailing={<StatusChip label={t.documentStatus[doc.status]} tone={statusTone[doc.status]} />} title={copy.status}>
        <FactGrid
          facts={[
            { icon: 'cloud-upload-outline', label: copy.uploaded, value: formatDate(doc.uploaded_at, lang) },
            { icon: 'calendar-outline', label: copy.dated, value: doc.document_date ? formatDate(doc.document_date, lang) : copy.unknownDate },
            { icon: 'documents-outline', label: copy.pages, value: num(doc.page_count, lang) },
          ]}
        />
      </Panel>
      {status()}
      <Panel icon="image-outline" title={copy.original}>
        <OriginalFile doc={doc} />
      </Panel>

      <ConfirmSheet
        visible={confirming}
        title={copy.deleteTitle}
        body={copy.deleteBody(saved.length)}
        options={[
          ...(saved.length > 0
            ? [{ id: 'with-items', label: copy.deleteWithItems(saved.length), tone: 'danger' as const, icon: 'trash-outline' as const }]
            : []),
          { id: 'only', label: copy.deleteOnly, tone: saved.length > 0 ? ('secondary' as const) : ('danger' as const) },
        ]}
        onSelect={async (id) => {
          await deleteDocument(doc, id === 'with-items');
          setConfirming(false);
          navigation.goBack();
        }}
        onClose={() => setConfirming(false)}
      />
    </HealthFrame>
  );
}
