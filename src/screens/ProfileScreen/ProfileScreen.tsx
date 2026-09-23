import Ionicons from '@expo/vector-icons/Ionicons';
import { StatusBar } from 'expo-status-bar';
import { useMemo } from 'react';
import { ScrollView, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { AppText } from '../../components/common/AppText';
import { BackButton } from '../../components/common/BackButton';
import { GlassSurface } from '../../components/common/GlassSurface';
import { BottomBar } from '../../components/layout/BottomBar';
import { ScreenWrapper } from '../../components/layout/ScreenWrapper';
import { Avatar } from '../../components/ui/Avatar';
import { ServiceTile } from '../../components/ui/ServiceTile';
import { images } from '../../constants/images';
import { useAppTheme } from '../../hooks/useAppTheme';
import { initialsOf, resident } from '../HomeScreen/HomeScreen.data';
import { accessPassPayload, profileCopy, profileMenu } from './ProfileScreen.data';
import { PASS_SIZE, createStyles } from './ProfileScreen.styles';

export function ProfileScreen() {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const fullName = `${resident.firstName} ${resident.lastName}`;

  return (
    <ScreenWrapper
      backgroundSource={images.homeBackground}
      withScrim={false}
      backgroundOverlay={0.34}
      withGutter
    >
      <StatusBar style="light" />

      <View style={styles.flex}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <BackButton />
            <AppText variant="cardTitle" style={styles.headerTitle}>
              {profileCopy.title}
            </AppText>
          </View>

          <GlassSurface
            radius={theme.borderRadius.xl}
            stroke="gradient"
            strokeColors={[theme.colors.featureStrokeFrom, theme.colors.featureStrokeTo]}
            style={styles.identity}
          >
            <Avatar initials={initialsOf(resident)} size={36} variant="flat" />
            <View style={styles.identityText}>
              <AppText variant="tileTitle">{fullName}</AppText>
            </View>
            <Ionicons name="chevron-forward" size={15} color={theme.colors.textSecondary} />
          </GlassSurface>

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
              variant="tileSubtitle"
              color={theme.colors.textSecondary}
              style={styles.passCaption}
            >
              {profileCopy.passCaption}
            </AppText>
          </GlassSurface>

          {profileMenu.map((item) => (
            <ServiceTile
              key={item.id}
              title={item.title}
              iconSet={item.iconSet}
              iconName={item.iconName}
              style={styles.menuRow}
              onPress={() => {
                // TODO(nav): route to the `item.id` screen once it is designed.
              }}
            />
          ))}
        </ScrollView>

        <BottomBar height={62} style={styles.bottomBar} />
      </View>
    </ScreenWrapper>
  );
}
