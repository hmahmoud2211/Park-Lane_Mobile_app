import { useEffect, useRef, useState } from 'react';
import { Platform, View } from 'react-native';

import { AppButton } from '../../components/common/AppButton';
import { AppInput } from '../../components/common/AppInput';
import { AppText } from '../../components/common/AppText';
import { GlassSurface } from '../../components/common/GlassSurface';
import { QrScanner } from '../../components/common/QrScanner';
import { LoadingState } from '../../components/feedback/LoadingState';
import { Notice } from '../../components/feedback/Notice';
import { NeonPanel } from '../../components/ui/NeonPanel';
import { PanelHeading } from '../../components/ui/PanelHeading';
import { EmsError } from '../../features/ems/services/emsHttp';
import { codeFromText, formatCodeInput, inviteProblem, isCodeComplete, type InviteProblem } from '../../features/unit/services/unitRules';
import type { MyUnit, UnitInvitePreview } from '../../features/unit/types';
import { useAppTheme } from '../../hooks/useAppTheme';
import { pasteText } from '../../utils/share';
import { householdCopy as copy } from './HouseholdScreen.data';
import { BUTTON_HEIGHT, FIELD_HEIGHT, SMALL_BUTTON_HEIGHT, type createStyles } from './HouseholdScreen.styles';

interface JoinPanelProps {
  /** A code the screen was opened with (an invite link): checked at once. */
  initialCode: string | null;
  /** True when the resident already has an apartment: only a linked code's outcome is shown, no field. */
  inUnit: boolean;
  check: (code: string) => Promise<UnitInvitePreview>;
  join: (code: string) => Promise<MyUnit>;
  onJoined: (unitName: string) => void;
  styles: ReturnType<typeof createStyles>;
}

const problemOf = (error: unknown): InviteProblem =>
  error instanceof EmsError ? inviteProblem(error.code, error.message) : inviteProblem(null, 'Something went wrong. Try again.');

/**
 * Joining with an invite: from a link the code is already there; otherwise paste it, scan the
 * owner's QR code or type it. A complete code is checked straight away, so the resident sees
 * which apartment it is before one tap on Join.
 */
export function JoinPanel({ initialCode, inUnit, check, join, onJoined, styles }: JoinPanelProps) {
  const theme = useAppTheme();
  const [code, setCode] = useState(initialCode ?? '');
  const [checking, setChecking] = useState(Boolean(initialCode));
  const [preview, setPreview] = useState<{ code: string; data: UnitInvitePreview } | null>(null);
  const [problem, setProblem] = useState<InviteProblem | null>(null);
  const [joining, setJoining] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // Only the latest check may answer: typing on while one is out must not show an older code's apartment.
  const latest = useRef<string | null>(null);

  const runCheck = async (value: string) => {
    latest.current = value;
    setChecking(true);
    setProblem(null);
    setPreview(null);
    setNote(null);
    try {
      const data = await check(value);
      if (latest.current === value) setPreview({ code: value, data });
    } catch (error) {
      if (latest.current === value) setProblem(problemOf(error));
    } finally {
      if (latest.current === value) setChecking(false);
    }
  };

  // The link's code, once (the screen gives this panel a new key for a new link).
  const checkInitial = useRef(runCheck);
  useEffect(() => {
    if (initialCode) void checkInitial.current(initialCode);
  }, [initialCode]);

  const take = (value: string) => {
    setCode(value);
    void runCheck(value);
  };

  const onType = (text: string) => {
    const next = formatCodeInput(text);
    setCode(next);
    setProblem(null);
    setNote(null);
    if (isCodeComplete(next) && next !== code) {
      void runCheck(next);
    } else if (!isCodeComplete(next)) {
      latest.current = null;
      setPreview(null);
      setChecking(false);
    }
  };

  const paste = async () => {
    const text = await pasteText();
    const found = codeFromText(text) ?? (isCodeComplete(formatCodeInput(text)) ? formatCodeInput(text) : null);
    if (found) take(found);
    else setNote(copy.pasteEmpty);
  };

  const onScan = (data: string) => {
    const found = codeFromText(data);
    if (!found) {
      setNote(copy.scanWrong);
      return;
    }
    setScanOpen(false);
    take(found);
  };

  const confirm = async () => {
    if (!preview || joining) return;
    setJoining(true);
    try {
      const unit = await join(preview.code);
      onJoined(unit.unit.name);
    } catch (error) {
      setPreview(null);
      setProblem(problemOf(error));
    } finally {
      setJoining(false);
    }
  };

  const reset = () => {
    latest.current = null;
    setCode('');
    setPreview(null);
    setProblem(null);
    setNote(null);
    setChecking(false);
  };

  const renderPreview = ({ data }: { data: UnitInvitePreview }) =>
    data.alreadyMember ? (
      <Notice tone="success">{copy.alreadyIn(data.unit.name)}</Notice>
    ) : (
      <GlassSurface
        radius={theme.borderRadius.sm}
        blurred={false}
        glow
        strokeColors={[theme.colors.cardStrokeFrom, theme.colors.featureStrokeTo]}
        fillOpacity={theme.glass.subtleFillOpacity}
        style={styles.item}
      >
        <AppText variant="sectionTitle" accessibilityRole="header">
          {copy.previewTitle(data.unit.name)}
        </AppText>
        {data.unit.building ? (
          <AppText variant="tileCaption" color={theme.colors.textSupport}>
            {data.unit.building}
          </AppText>
        ) : null}
        <AppText variant="bodySmall" color={theme.colors.textSupport}>
          {copy.previewBy(data.invitedBy, data.role)}
        </AppText>
        <AppText variant="bodySmall" color={theme.colors.textSupport}>
          {copy.previewWhat}
        </AppText>
        <AppButton title={copy.join(data.unit.name)} variant="gradient" height={BUTTON_HEIGHT} loading={joining} onPress={() => void confirm()} />
        {inUnit ? null : <AppButton title={copy.otherCode} variant="secondary" height={SMALL_BUTTON_HEIGHT} disabled={joining} onPress={reset} />}
      </GlassSurface>
    );

  const outcome = (
    <>
      {checking ? <LoadingState label={copy.checking} announce /> : null}
      {preview ? renderPreview(preview) : null}
      {problem ? (
        <Notice
          tone={problem.retype ? 'warning' : 'error'}
          title={problem.title}
          actions={inUnit ? undefined : <AppButton title={copy.otherCode} variant="secondary" height={SMALL_BUTTON_HEIGHT} onPress={reset} />}
        >
          {problem.message}
        </Notice>
      ) : null}
    </>
  );

  // Already in an apartment: a linked code only says how it went (already in it, or in another one).
  if (inUnit) {
    return checking || preview || problem ? <NeonPanel style={styles.panel}>{outcome}</NeonPanel> : null;
  }

  return (
    <NeonPanel style={styles.panel}>
      <PanelHeading title={copy.joinTitle} iconSet="ionicons" iconName="enter-outline" divider />
      <AppText variant="bodySmall" color={theme.colors.textSupport}>
        {copy.joinBody}
      </AppText>
      <AppInput
        variant="field"
        label={copy.codeLabel}
        value={code}
        onChangeText={onType}
        autoCapitalize="characters"
        autoCorrect={false}
        autoComplete="off"
        placeholder="ABCD-EFGH"
        height={FIELD_HEIGHT}
        accessibilityHint={copy.joinBody}
      />
      <View style={styles.row}>
        <AppButton title={copy.paste} variant="secondary" height={SMALL_BUTTON_HEIGHT} onPress={() => void paste()} style={styles.action} />
        {Platform.OS !== 'web' ? (
          <AppButton
            title={scanOpen ? copy.closeScan : copy.scan}
            variant="secondary"
            height={SMALL_BUTTON_HEIGHT}
            onPress={() => {
              setScanOpen((open) => !open);
              setNote(null);
            }}
            style={styles.action}
          />
        ) : null}
      </View>
      {scanOpen ? (
        <>
          <AppText variant="tileCaption" color={theme.colors.textSupport}>
            {copy.scanHint}
          </AppText>
          <QrScanner onScan={onScan} onClose={() => setScanOpen(false)} />
        </>
      ) : null}
      {note ? <Notice tone="info">{note}</Notice> : null}
      {outcome}
    </NeonPanel>
  );
}
