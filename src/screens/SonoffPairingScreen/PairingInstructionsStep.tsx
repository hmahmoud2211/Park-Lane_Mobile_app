import { useMemo } from 'react';
import { View } from 'react-native';

import { FeatureBanner } from '../../components/ui/FeatureBanner';
import { NeonPanel } from '../../components/ui/NeonPanel';
import { PairingStep } from '../../components/ui/PairingStep';
import { PanelHeading } from '../../components/ui/PanelHeading';
import { imageAspects, images } from '../../constants/images';
import { useAppTheme } from '../../hooks/useAppTheme';
import { Notice, PrimaryAction } from './PairingParts';
import { instructions, pairingCopy as copy } from './SonoffPairingScreen.data';
import { createStyles } from './SonoffPairingScreen.styles';

/** Stage 1: how to put the plug into Compatible Pairing mode. */
export function PairingInstructionsStep({ onContinue }: { onContinue: () => void }) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <View>
      <FeatureBanner
        title={copy.bannerTitle}
        body={copy.bannerBody}
        photo={images.smartHomeHero}
        photoAspect={imageAspects.smartHomeHero}
        style={styles.card}
      />

      <NeonPanel style={[styles.card, styles.panelTight]}>
        <PanelHeading
          title={copy.instructionsTitle}
          iconSet="material"
          iconName="gesture-tap-hold"
          iconSize={19}
        />
        <View style={[styles.panelBody, styles.gapTop]}>
          {instructions.map((step, index) => (
            <PairingStep
              key={step.title}
              index={index + 1}
              title={step.title}
              body={step.body}
              connector={index < instructions.length - 1}
            />
          ))}
          <Notice tone="info" style={styles.gapTopSmall}>
            {copy.testedWith}
          </Notice>
        </View>
      </NeonPanel>

      <PrimaryAction title={copy.continue} onPress={onContinue} />
    </View>
  );
}
