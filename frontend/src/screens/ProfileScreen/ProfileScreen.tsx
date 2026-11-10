import Ionicons from '@expo/vector-icons/Ionicons';
import { useNavigation } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { useMemo } from 'react';
import { ScrollView, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { AppText } from '../../components/common/AppText';
import { GlassSurface } from '../../components/common/GlassSurface';
import { BottomBar } from '../../components/layout/BottomBar';
import { PageHeader } from '../../components/layout/PageHeader';
import { ResponsiveColumns } from '../../components/layout/ResponsiveColumns';
import { ScreenWrapper } from '../../components/layout/ScreenWrapper';
import { Avatar } from '../../components/ui/Avatar';
import { ServiceTile } from '../../components/ui/ServiceTile';
import { flags } from '../../config/flags';
import { images } from '../../constants/images';
import { useResidentIdentity } from '../../features/home/hooks/useResidentIdentity';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useScreenLayout } from '../../hooks/useScreenLayout';
import type { RootStackScreenProps } from '../../types/navigation.types';
import { accessPassPayload, profileCopy, profileMenu } from './ProfileScreen.data';
import { PASS_SIZE, createStyles } from './ProfileScreen.styles';

export function ProfileScreen() {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const layout = useScreenLayout();
  const navigation = useNavigation<RootStackScreenProps<'Profile'>['navigation']>();
  const identity = useResidentIdentity();
  // The gate pass is a fixed sample code, so the store build doesn't show it.
  const sample = flags.sampleContent;

  return (
    <ScreenWrapper
      backgroundSource={images.homeBackground}
      withScrim={false}
      backgroundOverlay={0.34}
    >
      <StatusBar style="light" />

      <View style={styles.flex}>
        <ScrollView
          contentContainerStyle={[styles.content, layout.contentStyle]}
          showsVerticalScrollIndicator={false}
        >
          <PageHeader title={profileCopy.title} style={[styles.header, layout.isWide && styles.headerWide]} />

          {/*
            Who and the access pass on the left, the account menu on the
            right. Cards keep their own bottom margins, so no column gap.
          */}
          <ResponsiveColumns gap={0}>
            <>
              <GlassSurface
                radius={theme.borderRadius.xl}
                stroke="gradient"
                strokeColors={[theme.colors.featureStrokeFrom, theme.colors.featureStrokeTo]}
                style={styles.identity}
              >
                <Avatar initials={identity.initials} size={36} variant="flat" />
                <View style={styles.identityText}>
                  <AppText variant="sectionTitle">{identity.fullName}</AppText>
                  {identity.email ? (
                    <AppText variant="bodySmall" color={theme.colors.textSecondary}>
                      {identity.email}
                    </AppText>
                  ) : null}
                </View>
                {sample ? <Ionicons name="chevron-forward" size={15} color={theme.colors.textSecondary} /> : null}
              </GlassSurface>

              {sample ? (
                <GlassSurface
                  radius={theme.borderRadius.lg}
                  stroke="gradient"
                  style={styles.passCard}
                >
                  <View style={styles.passSurface}>
                    <QRCode
                      value={accessPassPayload}
                      size={PASS_SIZE}
                      color={theme.colors.deepNavy}
                      backgroundColor={theme.colors.white}
                    />
                  </View>
                  <AppText
                    variant="tileCaption"
                    color={theme.colors.textSecondary}
                    style={styles.passCaption}
                  >
                    {profileCopy.passCaption}
                  </AppText>
                </GlassSurface>
              ) : null}
            </>

            <>
              {profileMenu.map((item) => (
                <ServiceTile
                  key={item.id}
                  title={item.title}
                  iconSet={item.iconSet}
                  iconName={item.iconName}
                  style={styles.menuRow}
                  onPress={() => {
                    // TODO(nav): the sample rows have no screen yet; the store build has none of those.
                    if (item.route) {
                      navigation.navigate(item.route);
                    }
                  }}
                />
              ))}
            </>
          </ResponsiveColumns>
        </ScrollView>

        <BottomBar inset={theme.spacing.screenGutter} />
      </View>
    </ScreenWrapper>
  );
}
