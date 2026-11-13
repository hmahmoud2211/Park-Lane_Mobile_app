import { useNavigation, useRoute } from '@react-navigation/native';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { AppText } from '../../components/common/AppText';
import { BidiText } from '../../features/health/components/BidiText';
import { ReportAnswer } from '../../features/aiReports/components/ReportAnswer';
import { ConfirmSheet } from '../../features/health/components/ConfirmSheet';
import { HealthFrame } from '../../features/health/components/HealthFrame';
import { ItemRow } from '../../features/health/components/ItemRow';
import { ResourceView } from '../../features/health/components/LoadState';
import { OriginalFile } from '../../features/health/components/OriginalFile';
import { sectionIcon, statusTone } from '../../features/health/components/presenters';
import { FactGrid } from '../../components/ui/Controls';
import { Notice } from '../../components/feedback/Notice';
import { Panel } from '../../components/ui/Panel';
import { ParkingButton } from '../../components/ui/ParkingButton';
import { StatusChip } from '../../components/ui/StatusChip';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useHealth } from '../../features/health/hooks/useHealth';
import { useCanEditProfile, useHealthDocument, useHealthRecord, useHealthState } from '../../features/health/hooks/useHealthData';
import type { HealthDocument } from '../../types/health.types';
import { formatDate, num } from '../../features/health/services/i18n';
import { describeItem, itemsFromDocument } from '../../features/health/services/selectors';
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
  // On a record shared to view only, the document is read, never reviewed, retried, edited or deleted.
  const canEdit = useCanEditProfile(doc.profile_id);
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
              canEdit ? (
                <ParkingButton
                  compact
                  tone="primary"
                  icon="checkmark-done-outline"
                  label={copy.review}
                  onPress={() => navigation.replace('HealthReview', { docId: doc.id })}
                />
              ) : undefined
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
              canEdit ? (
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
              ) : undefined
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
              {/* Read by AI: the reading can be reported (Google Play's AI-Generated Content policy). */}
              <ReportAnswer source="health_review" excerpt={doc.extracted_text} copy={t.report} direction={lang === 'ar' ? 'rtl' : 'ltr'} />
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
                      onEdit={
                        canEdit
                          ? () => navigation.navigate('HealthItemForm', { profileId: doc.profile_id, section, itemId: item.id })
                          : undefined
                      }
                    />
                  ))}
                </View>
              )}
            </Panel>
          ) : null}
          {canEdit ? <ParkingButton tone="danger" icon="trash-outline" label={copy.delete} onPress={() => setConfirming(true)} /> : null}
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
