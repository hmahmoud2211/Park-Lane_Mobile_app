import { useNavigation, useRoute } from '@react-navigation/native';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { AppText } from '../../components/common/AppText';
import { BidiText } from '../../components/health/BidiText';
import { HealthFrame } from '../../components/health/HealthFrame';
import { ItemFields } from '../../components/health/ItemFields';
import { ErrorNotice, ResourceView } from '../../components/health/LoadState';
import { OriginalFile } from '../../components/health/OriginalFile';
import { sectionIcon } from '../../components/health/presenters';
import { TextLink } from '../../components/health/TextLink';
import { ChipGroup } from '../../components/parking/Controls';
import { Notice } from '../../components/parking/Notice';
import { Panel } from '../../components/parking/Panel';
import { ParkingButton } from '../../components/parking/ParkingButton';
import { StatusChip } from '../../components/ui/StatusChip';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useHealth } from '../../hooks/useHealth';
import { useHealthDocument, useHealthRecord } from '../../hooks/useHealthData';
import { useScreenLayout } from '../../hooks/useScreenLayout';
import type { HealthDocument, HealthRecord, ItemData, RecordSection } from '../../services/health/health.types';
import { isHealthError, type HealthError } from '../../services/health/healthService';
import { dataFrom, draftFrom, validateDraft, type Draft, type DraftErrors } from '../../services/health/itemForm';
import {
  allDecided,
  canConfirm,
  canConfirmAll,
  confirmRemaining,
  startReview,
  toConfirmInput,
  savedCount,
  update,
  type DuplicateChoice,
  type ReviewEntry,
} from '../../services/health/review';
import { describeItem } from '../../services/health/selectors';
import type { RootStackScreenProps } from '../../types/navigation.types';
import { reviewCopy } from './HealthReviewScreen.data';
import { createStyles } from './HealthReviewScreen.styles';

type Navigation = RootStackScreenProps<'HealthReview'>['navigation'];

/**
 * The safety check between the AI's reading and the record: every extracted
 * item is confirmed, corrected or removed by the resident, the doubtful ones
 * first and one by one, with the original a tap away. Only confirmed items
 * are saved, and the review can be saved partway and finished later.
 */
export function HealthReviewScreen() {
  const { params } = useRoute<RootStackScreenProps<'HealthReview'>['route']>();
  const navigation = useNavigation<Navigation>();
  const { lang } = useHealth();
  const copy = reviewCopy[lang];
  const doc = useHealthDocument(params.docId);
  // Held here, not in the review: saving moves the document out of review, which would unmount it.
  const [saved, setSaved] = useState<Saved | null>(null);

  if (saved) {
    return (
      <HealthFrame
        title={copy.title}
        bottomBar={false}
        sideNav
        footer={<ParkingButton tone="primary" label={copy.done} onPress={() => navigation.goBack()} />}
      >
        <Notice tone="success" title={copy.savedTitle}>
          {saved.finished ? copy.savedBody(saved.count) : `${copy.savedBody(saved.count)} ${copy.savedLaterBody}`}
        </Notice>
      </HealthFrame>
    );
  }
  if (doc.data?.status === 'needs_review') {
    return <ReviewBody key={doc.data.id} doc={doc.data} onSaved={setSaved} />;
  }
  return (
    <HealthFrame title={copy.title}>
      <ResourceView resource={doc}>
        {(loaded) => (
          <Notice
            tone="info"
            title={copy.notReadyTitle}
            actions={
              <ParkingButton
                compact
                label={copy.viewDocument}
                onPress={() => navigation.replace('HealthDocument', { docId: loaded.id })}
              />
            }
          />
        )}
      </ResourceView>
    </HealthFrame>
  );
}

function existingItem(record: HealthRecord | undefined, section: RecordSection, id: string | null) {
  if (!record || !id) return null;
  return (record[section] as { id: string }[]).find((item) => item.id === id) ?? null;
}

interface Saved {
  count: number;
  finished: boolean;
}

function ReviewBody({ doc, onSaved }: { doc: HealthDocument; onSaved: (saved: Saved) => void }) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { lang, t, confirm } = useHealth();
  const copy = reviewCopy[lang];
  const { columns } = useScreenLayout();
  const record = useHealthRecord(doc.profile_id);

  const [entries, setEntries] = useState<ReviewEntry[]>(() => startReview(doc.extracted_items ?? []));
  const [editing, setEditing] = useState<{ id: string; draft: Draft; errors: DraftErrors } | null>(null);
  const [showOriginal, setShowOriginal] = useState(columns > 1);
  const [showText, setShowText] = useState(false);
  const [saving, setSaving] = useState<'finish' | 'later' | null>(null);
  const [error, setError] = useState<HealthError | null>(null);

  const decided = entries.filter((e) => e.state !== 'pending').length;
  const everythingDecided = allDecided(entries);
  const gateOpen = canConfirmAll(entries);

  const save = async (finished: boolean) => {
    setSaving(finished ? 'finish' : 'later');
    setError(null);
    try {
      const input = toConfirmInput(entries, finished);
      await confirm(doc, input);
      onSaved({ count: savedCount(input), finished });
    } catch (caught) {
      if (isHealthError(caught)) setError(caught);
    } finally {
      setSaving(null);
    }
  };

  const startEdit = (entry: ReviewEntry) =>
    setEditing({ id: entry.item.item_id, draft: draftFrom(entry.item.section, entry.data as never), errors: {} });

  const saveEdit = (entry: ReviewEntry) => {
    if (!editing) return;
    const errors = validateDraft(entry.item.section, editing.draft);
    if (Object.keys(errors).length > 0) {
      setEditing({ ...editing, errors });
      return;
    }
    const data = dataFrom(entry.item.section, editing.draft, entry.data as never) as ItemData<RecordSection>;
    setEntries((current) => update(current, entry.item.item_id, { data, edited: true, state: 'confirmed' }));
    setEditing(null);
  };

  const card = (entry: ReviewEntry) => {
    const { item } = entry;
    const section = item.section;
    const low = item.confidence === 'low';
    const pending = entry.state === 'pending';
    const summary = describeItem(section, entry.data as never, lang);
    const isEditing = editing?.id === item.item_id;
    const existing = existingItem(record.data, section, item.possible_duplicate_of);
    const chip =
      entry.state === 'confirmed' ? (
        <StatusChip label={copy.confirmed} tone="teal" icon="checkmark" />
      ) : entry.state === 'removed' ? (
        <StatusChip label={copy.removed} tone="slate" />
      ) : low ? (
        <StatusChip label={copy.lowConfidence} tone="amber" icon="alert" />
      ) : undefined;

    return (
      <Panel
        key={item.item_id}
        icon={sectionIcon[section]}
        title={t.sections[section].one}
        trailing={chip}
        style={entry.state === 'removed' ? styles.dimmed : undefined}
      >
        {low && pending ? (
          <Notice tone="warning" title={copy.lowConfidence}>
            {copy.lowConfidenceBody}
          </Notice>
        ) : null}

        {isEditing && editing ? (
          <>
            <ItemFields
              section={section}
              draft={editing.draft}
              errors={editing.errors}
              onChange={(draft) => setEditing({ ...editing, draft })}
            />
            <View style={styles.actions}>
              <ParkingButton compact tone="primary" icon="checkmark" label={copy.saveEdit} style={styles.action} onPress={() => saveEdit(entry)} />
              <ParkingButton compact label={t.actions.cancel} style={styles.action} onPress={() => setEditing(null)} />
            </View>
          </>
        ) : (
          <View style={styles.figure}>
            <BidiText variant="bodyStrong">{summary.title}</BidiText>
            {/* Doses, values and dates are what a misreading gets wrong, so they're drawn large. */}
            {summary.emphasis ? <BidiText variant="figure">{summary.emphasis}</BidiText> : null}
            {summary.lines.map((line) => (
              <BidiText key={line} variant="caption" color={theme.colors.textSecondary}>
                {line}
              </BidiText>
            ))}
          </View>
        )}

        {item.possible_duplicate_of && entry.state !== 'removed' ? (
          <Notice tone="info" title={copy.duplicateTitle}>
            {existing ? (
              <BidiText variant="caption" color={theme.colors.textSecondary}>
                {`${copy.duplicateExisting} ${[
                  describeItem(section, existing as never, lang).title,
                  describeItem(section, existing as never, lang).emphasis,
                ]
                  .filter(Boolean)
                  .join(' · ')}`}
              </BidiText>
            ) : null}
            <ChipGroup
              options={[
                { value: 'both' as DuplicateChoice, label: copy.keepBoth },
                { value: 'replace' as DuplicateChoice, label: copy.replace },
                { value: 'skip' as DuplicateChoice, label: copy.skip },
              ]}
              value={entry.duplicate}
              onChange={(choice) =>
                setEntries((current) =>
                  // Choosing is the resident's decision on this item; Undo and Edit still work after.
                  update(current, item.item_id, { duplicate: choice, state: 'confirmed' }),
                )
              }
            />
          </Notice>
        ) : null}

        {isEditing ? null : pending ? (
          <>
            <View style={styles.actions}>
              <ParkingButton
                compact
                tone="primary"
                icon="checkmark"
                label={copy.confirm}
                disabled={!canConfirm(entry)}
                style={styles.action}
                onPress={() => setEntries((current) => update(current, item.item_id, { state: 'confirmed' }))}
              />
              <ParkingButton compact icon="create-outline" label={copy.edit} style={styles.action} onPress={() => startEdit(entry)} />
              <ParkingButton
                compact
                icon="trash-outline"
                label={copy.remove}
                style={styles.action}
                onPress={() => setEntries((current) => update(current, item.item_id, { state: 'removed' }))}
              />
            </View>
            {!canConfirm(entry) ? (
              <AppText variant="label" color={theme.colors.textMuted}>
                {copy.chooseDuplicate}
              </AppText>
            ) : null}
          </>
        ) : (
          <View style={styles.actions}>
            <ParkingButton
              compact
              icon="arrow-undo-outline"
              label={copy.undo}
              style={styles.action}
              onPress={() =>
                setEntries((current) =>
                  update(current, item.item_id, { state: 'pending', duplicate: entry.duplicate === 'skip' ? null : entry.duplicate }),
                )
              }
            />
            {entry.state === 'confirmed' && entry.duplicate !== 'skip' ? (
              <ParkingButton compact icon="create-outline" label={copy.edit} style={styles.action} onPress={() => startEdit(entry)} />
            ) : null}
          </View>
        )}
      </Panel>
    );
  };

  const footer = (
    <View style={styles.footer}>
      {everythingDecided ? (
        <ParkingButton tone="primary" icon="save-outline" label={copy.save} loading={saving === 'finish'} disabled={saving !== null} onPress={() => void save(true)} />
      ) : (
        <>
          {!gateOpen ? (
            <AppText variant="label" color={theme.colors.textSupport}>
              {copy.confirmAllLocked}
            </AppText>
          ) : null}
          <ParkingButton
            tone="primary"
            icon="checkmark-done-outline"
            label={copy.confirmAll}
            disabled={!gateOpen || editing !== null}
            onPress={() => setEntries((current) => confirmRemaining(current))}
          />
          <ParkingButton
            label={copy.saveLater}
            loading={saving === 'later'}
            disabled={decided === 0 || saving !== null}
            onPress={() => void save(false)}
          />
        </>
      )}
    </View>
  );

  // Beside the items where there is room; otherwise at the top, one tap from opening.
  const sideBySide = columns > 1;
  const originalPanel = (
    <Panel
      icon="image-outline"
      title={copy.original}
      trailing={<TextLink label={showOriginal ? copy.hideOriginal : copy.showOriginal} onPress={() => setShowOriginal((shown) => !shown)} />}
    >
      {showOriginal ? <OriginalFile doc={doc} /> : null}
    </Panel>
  );

  return (
    <HealthFrame
      title={copy.title}
      subtitle={`${t.documentType[doc.type]} · ${copy.progress(decided, entries.length)}`}
      bottomBar={false}
      sideNav
      footer={footer}
      aside={
        <>
          {sideBySide ? originalPanel : null}
          <Panel
            icon="reader-outline"
            title={copy.fullText}
            trailing={<TextLink label={showText ? copy.hideText : copy.showText} onPress={() => setShowText((shown) => !shown)} />}
          >
            {showText && doc.extracted_text ? (
              <View style={styles.textBox}>
                <BidiText variant="caption" selectable>
                  {doc.extracted_text}
                </BidiText>
              </View>
            ) : null}
          </Panel>
        </>
      }
      columnWeights={[3, 2]}
    >
      <Notice tone="warning" title={copy.warningTitle}>
        {copy.warningBody}
      </Notice>
      {sideBySide ? null : originalPanel}
      {entries.map(card)}
      {error ? <ErrorNotice error={error} onRetry={() => void save(everythingDecided)} /> : null}
    </HealthFrame>
  );
}
