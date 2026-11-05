import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '../../../components/common/AppText';
import { Avatar } from '../../../components/ui/Avatar';
import { NeonPanel } from '../../../components/ui/NeonPanel';
import { useAppTheme } from '../../../hooks/useAppTheme';
import type { Doctor } from '../types';
import { photoSource } from '../services/clinicApi';
import { fee, initialsOf, pick } from './presenters';
import type { HealthLang } from '../../../types/health.types';
import { num } from '../../health/services/i18n';
import type { AppTheme } from '../../../types/theme.types';

const PHOTO_SIZE = 58;

/** One doctor in the directory: photo, name, title and specialty, then experience, fee and visit length. */
export function DoctorCard({ doctor, lang, onPress, years, minutes }: {
  doctor: Doctor;
  lang: HealthLang;
  onPress: () => void;
  years: (count: number) => string;
  minutes: (count: number) => string;
}) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const photo = photoSource(doctor.photo_url);
  const name = pick(doctor.name, lang);
  const facts = [
    doctor.years_experience !== null ? years(doctor.years_experience) : null,
    minutes(doctor.consultation_minutes),
    fee(doctor.fee_egp, lang),
  ].filter((fact): fact is string => Boolean(fact));

  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${name}, ${pick(doctor.specialty.name, lang)}`}>
      {({ pressed }) => (
        <NeonPanel style={[styles.card, pressed && styles.pressed]}>
          {photo ? (
            <Image source={photo} style={styles.photo} accessibilityIgnoresInvertColors />
          ) : (
            <Avatar initials={initialsOf(name)} size={PHOTO_SIZE} labelVariant="sectionTitle" />
          )}
          <View style={styles.text}>
            <AppText variant="sectionTitle">{name}</AppText>
            <AppText variant="label" color={theme.colors.textSupport}>
              {[pick(doctor.title, lang), pick(doctor.specialty.name, lang)].filter(Boolean).join(' · ')}
            </AppText>
            <AppText variant="label" color={theme.colors.textMuted} style={styles.facts}>
              {num(facts.join(' · '), lang)}
            </AppText>
          </View>
          <Ionicons name={lang === 'ar' ? 'chevron-back' : 'chevron-forward'} size={16} color={theme.colors.textMuted} />
        </NeonPanel>
      )}
    </Pressable>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.md - 4,
      padding: theme.spacing.md - 4,
    },
    pressed: {
      opacity: 0.85,
    },
    photo: {
      width: PHOTO_SIZE,
      height: PHOTO_SIZE,
      borderRadius: PHOTO_SIZE / 2,
      borderWidth: 1,
      borderColor: theme.colors.avatarStroke,
    },
    text: {
      flex: 1,
      gap: 2,
    },
    facts: {
      marginTop: 4,
    },
  });
}
