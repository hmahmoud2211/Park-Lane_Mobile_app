import { useNavigation } from '@react-navigation/native';
import { useEffect, useMemo } from 'react';
import { View } from 'react-native';

import { AppText } from '../../components/common/AppText';
import { BidiText } from '../../components/health/BidiText';
import { HealthFrame } from '../../components/health/HealthFrame';
import { ErrorNotice, LoadingPanel, ResourceView } from '../../components/health/LoadState';
import { documentIcon, documentLines, profileLine, statusTone } from '../../components/health/presenters';
import { TextLink } from '../../components/health/TextLink';
import { ChipGroup } from '../../components/parking/Controls';
import { Notice } from '../../components/parking/Notice';
import { Panel } from '../../components/parking/Panel';
import { ParkingButton } from '../../components/parking/ParkingButton';
import { ListRow } from '../../components/parking/Rows';
import { StatusChip, type StatusTone } from '../../components/ui/StatusChip';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useHealth } from '../../hooks/useHealth';
import {
  useHealthConsent,
  useHealthDocuments,
  useHealthProfiles,
  useHealthRecord,
  useHealthState,
  useHealthSummary,
} from '../../hooks/useHealthData';
import type { HealthDocument, HealthRecord, Severity, Summary } from '../../services/health/health.types';
import {
  awaitingReview,
  gapFix,
  hasSevereAllergy,
  inProgress,
  splitMedications,
  summaryIsStale,
} from '../../services/health/selectors';
import type { RecordTab, RootStackScreenProps } from '../../types/navigation.types';
import { CARD_LIMIT, passportCopy } from './HealthPassportScreen.data';
import { createStyles } from './HealthPassportScreen.styles';

type Navigation = RootStackScreenProps<'HealthPassport'>['navigation'];

const severityTone: Record<Severity, StatusTone> = { mild: 'slate', moderate: 'amber', severe: 'red' };

/**
 * Health Passport's home. A resident who hasn't agreed to the terms is sent
 * to onboarding first; nothing is fetched beyond the consent status until
 * they have.
 */
export function HealthPassportScreen() {
  const navigation = useNavigation<Navigation>();
  const { lang } = useHealth();
  const consent = useHealthConsent();
  const copy = passportCopy[lang];
  const needsConsent = consent.data !== undefined && !consent.data.given;

  useEffect(() => {
    if (needsConsent) navigation.replace('HealthOnboarding');
  }, [needsConsent, navigation]);

  if (consent.data?.given) {
    return <PassportHome />;
  }
  return (
    <HealthFrame title={copy.title} subtitle={copy.subtitle}>
      {consent.error && !consent.loading ? <ErrorNotice error={consent.error} onRetry={consent.reload} /> : <LoadingPanel />}
    </HealthFrame>
  );
}

function PassportHome() {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const navigation = useNavigation<Navigation>();
  const { lang, t, activeProfileId, setActiveProfileId, recheckDocument } = useHealth();
  const copy = passportCopy[lang];
  const profiles = useHealthProfiles();
  const list = profiles.data;

  // The resident's own record first, and back to it if the shown profile is removed.
  const activeId = list?.some((p) => p.id === activeProfileId) ? activeProfileId : (list?.[0]?.id ?? null);
  useEffect(() => {
    if (activeId && activeId !== activeProfileId) setActiveProfileId(activeId);
  }, [activeId, activeProfileId, setActiveProfileId]);

  const record = useHealthRecord(activeId);
  // The general summary the server keeps ready after each record change, in either language.
  const generalAr = useHealthSummary(activeId, 'ar', 'general');
  const generalEn = useHealthSummary(activeId, 'en', 'general');
  const readySummary = [generalAr.data, generalEn.data].find(
    (s): s is Summary => s?.status === 'ready' && !summaryIsStale(s, record.data?.record_updated_at),
  );
  const documents = useHealthDocuments(activeId);
  const { slowJobs } = useHealthState();
  const profile = list?.find((p) => p.id === activeId);

  const openTab = (tab: RecordTab) => activeId && navigation.navigate('HealthRecords', { profileId: activeId, tab });

  const seeAll = (tab: RecordTab) => <TextLink label={copy.seeAll} onPress={() => openTab(tab)} />;

  const progress = (docs: HealthDocument[]) => {
    const reading = inProgress(docs);
    const slow = reading.filter((d) => slowJobs.includes(d.id));
    const waiting = awaitingReview(docs);
    if (reading.length === 0 && waiting.length === 0) return null;
    return (
      <Panel icon="hourglass-outline" title={copy.progressTitle}>
        {reading.length > slow.length ? (
          <ListRow
            icon="sync-outline"
            title={copy.reading(reading.length - slow.length)}
            lines={[copy.readingDetail]}
            statusLabel={t.documentStatus.processing}
            statusTone="slate"
            onPress={() => openTab('documents')}
          />
        ) : null}
        {slow.map((doc) => (
          <Notice
            key={doc.id}
            tone="warning"
            title={copy.slow}
            actions={<ParkingButton compact icon="refresh" label={copy.checkAgain} onPress={() => recheckDocument(doc.id)} />}
          >
            {`${t.documentType[doc.type]} · ${copy.slowDetail}`}
          </Notice>
        ))}
        {waiting.length > 0 ? (
          <AppText variant="caption" color={theme.colors.textSecondary}>
            {`${copy.waiting(waiting.length)}. ${copy.waitingDetail}`}
          </AppText>
        ) : null}
        {waiting.map((doc, index) => (
          <ListRow
            key={doc.id}
            divided={index > 0}
            icon={documentIcon[doc.type]}
            title={t.documentType[doc.type]}
            lines={documentLines(doc, lang)}
            statusLabel={t.documentStatus.needs_review}
            statusTone="amber"
            onPress={() => navigation.navigate('HealthReview', { docId: doc.id })}
          />
        ))}
      </Panel>
    );
  };

  const recordCards = (rec: HealthRecord) => {
    const severe = rec.allergies.filter((a) => a.severity === 'severe');
    const current = splitMedications(rec.medications).current;
    const active = rec.conditions.filter((c) => c.status === 'active');
    return (
      <>
        <Panel icon="warning-outline" title={copy.allergies} trailing={seeAll('allergies')}>
          {hasSevereAllergy(rec) ? (
            <Notice tone="error" title={copy.severeAllergy(severe.map((a) => a.substance).join(lang === 'ar' ? '، ' : ', '))} />
          ) : null}
          {rec.allergies.length === 0 ? (
            <AppText variant="caption" color={theme.colors.textSecondary}>
              {t.sections.allergies.empty}
            </AppText>
          ) : (
            rec.allergies.slice(0, CARD_LIMIT).map((allergy) => (
              <View key={allergy.id} style={styles.line}>
                <View style={styles.lineText}>
                  <BidiText variant="bodyStrong">{allergy.substance}</BidiText>
                  {allergy.reaction ? (
                    <BidiText variant="label" color={theme.colors.textSupport}>
                      {allergy.reaction}
                    </BidiText>
                  ) : null}
                </View>
                <StatusChip label={t.severity[allergy.severity]} tone={severityTone[allergy.severity]} />
              </View>
            ))
          )}
        </Panel>
        <Panel icon="medical-outline" title={copy.medications} trailing={seeAll('medications')}>
          {current.length === 0 ? (
            <AppText variant="caption" color={theme.colors.textSecondary}>
              {copy.noneActive}
            </AppText>
          ) : (
            current.slice(0, CARD_LIMIT).map((med) => (
              <View key={med.id} style={styles.lineText}>
                <BidiText variant="bodyStrong">{med.name}</BidiText>
                {med.dose || med.frequency ? (
                  <BidiText variant="caption" color={theme.colors.textSecondary}>
                    {[med.dose, med.frequency].filter(Boolean).join(' · ')}
                  </BidiText>
                ) : null}
              </View>
            ))
          )}
        </Panel>
        <Panel icon="pulse-outline" title={copy.conditions} trailing={seeAll('conditions')}>
          {active.length === 0 ? (
            <AppText variant="caption" color={theme.colors.textSecondary}>
              {copy.noneActive}
            </AppText>
          ) : (
            active.slice(0, CARD_LIMIT).map((condition) => (
              <BidiText key={condition.id} variant="bodyStrong">
                {condition.name}
              </BidiText>
            ))
          )}
        </Panel>
      </>
    );
  };

  const latestDocuments = (docs: HealthDocument[]) => (
    <Panel icon="folder-open-outline" title={copy.latestDocuments} trailing={docs.length > 0 ? seeAll('documents') : undefined}>
      {docs.length === 0 ? (
        <AppText variant="caption" color={theme.colors.textSecondary}>
          {copy.noDocuments}
        </AppText>
      ) : (
        docs.slice(0, CARD_LIMIT).map((doc, index) => (
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
        ))
      )}
    </Panel>
  );

  const gaps = (rec: HealthRecord) =>
    rec.gaps.length === 0 || !activeId ? null : (
      <Panel icon="checkmark-done-outline" title={copy.gapsTitle} subtitle={copy.gapsSubtitle}>
        {rec.gaps.map((gap, index) => {
          const fix = gapFix(gap);
          const label = fix.kind === 'profile' ? copy.fixProfile : fix.kind === 'add' ? copy.fixAdd : copy.fixUpload;
          return (
            <View key={`${gap.kind}-${gap.test ?? ''}`} style={[styles.gap, index > 0 && styles.gapDivided]}>
              <View style={styles.gapText}>
                <AppText variant="caption">{gap.text}</AppText>
              </View>
              <ParkingButton
                compact
                label={label}
                icon={fix.kind === 'upload' ? 'cloud-upload-outline' : 'add'}
                accessibilityHint={gap.text}
                style={styles.fixButton}
                onPress={() => {
                  if (fix.kind === 'profile') navigation.navigate('HealthProfile', { profileId: activeId });
                  else if (fix.kind === 'add') {
                    navigation.navigate('HealthItemForm', { profileId: activeId, section: fix.section, labTest: fix.labTest });
                  }
                  else navigation.navigate('HealthUpload', { profileId: activeId, type: fix.type });
                }}
              />
            </View>
          );
        })}
      </Panel>
    );

  return (
    <HealthFrame
      title={copy.title}
      subtitle={copy.subtitle}
      aside={
        activeId ? (
          <>
            <ResourceView resource={record}>{recordCards}</ResourceView>
            <ResourceView resource={documents}>{latestDocuments}</ResourceView>
            <Panel>
              <ListRow
                icon="settings-outline"
                title={copy.settings}
                lines={[copy.settingsDetail]}
                onPress={() => navigation.navigate('HealthSettings')}
              />
            </Panel>
          </>
        ) : undefined
      }
    >
      <ResourceView resource={profiles}>
        {(all) =>
          profile && activeId ? (
            <>
              {all.length > 1 ? (
                <ChipGroup
                  scroll
                  label={copy.profiles}
                  options={all.map((p) => ({ value: p.id, label: p.name, detail: t.relation[p.relation] }))}
                  value={activeId}
                  onChange={setActiveProfileId}
                />
              ) : null}
              <Panel icon="person-circle-outline" title={profile.name} subtitle={profileLine(profile, lang)}>
                <ParkingButton
                  compact
                  icon="create-outline"
                  label={copy.editProfile}
                  onPress={() => navigation.navigate('HealthProfile', { profileId: activeId })}
                />
              </Panel>
              {documents.data ? progress(documents.data) : null}
              <View style={styles.actions}>
                <ParkingButton
                  tone="primary"
                  icon={readySummary ? 'play' : 'mic-outline'}
                  label={readySummary ? copy.summaryReady : copy.prepareSummary}
                  accessibilityHint={readySummary ? copy.summaryReadyHint : copy.prepareHint}
                  onPress={() =>
                    navigation.navigate(
                      'HealthSummary',
                      readySummary
                        ? { profileId: activeId, lang: readySummary.lang, specialty: readySummary.specialty }
                        : { profileId: activeId },
                    )
                  }
                />
                <AppText variant="label" color={theme.colors.textMuted} style={styles.hint}>
                  {readySummary ? copy.summaryReadyHint : copy.prepareHint}
                </AppText>
                <View style={styles.row}>
                  <ParkingButton
                    icon="cloud-upload-outline"
                    label={copy.upload}
                    style={styles.grow}
                    onPress={() => navigation.navigate('HealthUpload', { profileId: activeId })}
                  />
                  <ParkingButton
                    icon="add-circle-outline"
                    label={copy.addManually}
                    style={styles.grow}
                    onPress={() => navigation.navigate('HealthItemForm', { profileId: activeId })}
                  />
                </View>
              </View>
              {record.data ? gaps(record.data) : null}
            </>
          ) : null
        }
      </ResourceView>
    </HealthFrame>
  );
}
