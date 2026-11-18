import { useRef, useState } from 'react';
import { View } from 'react-native';

import { AppButton } from '../../components/common/AppButton';
import { AppInput } from '../../components/common/AppInput';
import { AppText } from '../../components/common/AppText';
import { LoadingState } from '../../components/feedback/LoadingState';
import { Notice } from '../../components/feedback/Notice';
import { NeonPanel } from '../../components/ui/NeonPanel';
import { PanelHeading } from '../../components/ui/PanelHeading';
import type { Circle, CircleInvitePreview } from '../../features/circles/types';
import { EmsError } from '../../features/ems/services/emsHttp';
import { codeFromText, formatCodeInput, inviteProblem, isCodeComplete, type InviteProblem } from '../../features/unit/services/unitRules';
import { useAppTheme } from '../../hooks/useAppTheme';
import { pasteText } from '../../utils/share';
import { circleCopy as copy } from './CircleScreen.data';
import { BUTTON_HEIGHT, FIELD_HEIGHT, SMALL_BUTTON_HEIGHT, type createStyles } from './CircleScreen.styles';

interface StartPanelProps {
  create: (name: string) => Promise<Circle>;
  check: (code: string) => Promise<CircleInvitePreview>;
  join: (code: string) => Promise<Circle>;
  /** A Circle was made or joined: the screen shows it. */
  onDone: (circle: Circle, message: string | null) => void;
  styles: ReturnType<typeof createStyles>;
}

function problemOf(error: unknown): InviteProblem {
  if (!(error instanceof EmsError)) return inviteProblem(null, 'Something went wrong. Try again.');
  // For a Circle, `conflict` means it is full or the person is in 10 already, not "in another apartment".
  return error.code === 'conflict' ? { title: copy.cantJoin, message: error.message, retype: false } : inviteProblem(error.code, error.message);
}

/**
 * Making a Circle (a name, one tap) and joining one with a code. Invite codes have the same shape as the apartment's,
 * so typing, pasting and checking work the same way: a complete code is checked straight away and the person sees
 * which Circle it is before one tap on Join.
 */
export function StartPanel({ create, check, join, onDone, styles }: StartPanelProps) {
  const theme = useAppTheme();
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [code, setCode] = useState('');
  const [checking, setChecking] = useState(false);
  const [preview, setPreview] = useState<{ code: string; data: CircleInvitePreview } | null>(null);
  const [problem, setProblem] = useState<InviteProblem | null>(null);
  const [joining, setJoining] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // Only the latest check may answer.
  const latest = useRef<string | null>(null);

  const make = async () => {
    if (creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      onDone(await create(name.trim() || copy.namePlaceholder), null);
    } catch (error) {
      setCreateError(error instanceof EmsError ? error.message : copy.createFailed);
    } finally {
      setCreating(false);
    }
  };

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
    if (found) {
      setCode(found);
      void runCheck(found);
    } else {
      setNote(copy.pasteEmpty);
    }
  };

  const confirm = async () => {
    if (!preview || joining) return;
    setJoining(true);
    try {
      const circle = await join(preview.code);
      onDone(circle, preview.data.alreadyMember ? copy.alreadyIn(circle.name) : copy.joined(circle.name));
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
  };

  return (
    <>
      <NeonPanel style={styles.panel}>
        <PanelHeading title={copy.startTitle} iconSet="ionicons" iconName="people-circle-outline" divider />
        <AppText variant="bodySmall" color={theme.colors.textSupport}>
          {copy.startBody}
        </AppText>
        <AppInput label={copy.nameLabel} value={name} onChangeText={setName} placeholder={copy.namePlaceholder} maxLength={40} height={FIELD_HEIGHT} />
        <AppButton title={copy.create} variant="gradient" height={BUTTON_HEIGHT} loading={creating} onPress={() => void make()} />
        {createError ? <Notice tone="error">{createError}</Notice> : null}
      </NeonPanel>

      <NeonPanel style={styles.panel}>
        <PanelHeading title={copy.joinTitle} iconSet="ionicons" iconName="enter-outline" divider />
        <AppText variant="bodySmall" color={theme.colors.textSupport}>
          {copy.joinBody}
        </AppText>
        {preview ? (
          <Notice
            tone="info"
            title={copy.previewTitle(preview.data.circle.name)}
            actions={
              <>
                <AppButton title={copy.join} variant="gradient" height={SMALL_BUTTON_HEIGHT} loading={joining} onPress={() => void confirm()} />
                <AppButton title={copy.otherCode} variant="secondary" height={SMALL_BUTTON_HEIGHT} disabled={joining} onPress={reset} />
              </>
            }
          >
            {preview.data.alreadyMember ? copy.alreadyIn(preview.data.circle.name) : copy.previewBody(preview.data.invitedBy, preview.data.circle.members)}
          </Notice>
        ) : (
          <>
            <AppInput
              label={copy.codeLabel}
              value={code}
              onChangeText={onType}
              placeholder="XXXX-XXXX"
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={40}
              height={FIELD_HEIGHT}
            />
            <View style={styles.row}>
              <AppButton title={copy.paste} variant="secondary" height={SMALL_BUTTON_HEIGHT} onPress={() => void paste()} style={styles.action} />
            </View>
            {checking ? <LoadingState label={copy.checking} /> : null}
          </>
        )}
        {problem ? (
          <Notice tone={problem.retype ? 'warning' : 'error'} title={problem.title}>
            {problem.message}
          </Notice>
        ) : null}
        {note ? <Notice tone="info">{note}</Notice> : null}
      </NeonPanel>
    </>
  );
}
