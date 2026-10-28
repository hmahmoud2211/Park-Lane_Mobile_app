import { DirectionView } from '../common/DirectionView';
import { AppText, type AppTextProps } from '../common/AppText';
import { useHealth } from '../../hooks/useHealth';
import { textDirection } from '../../services/health/i18n';

export interface BidiTextProps extends Omit<AppTextProps, 'children'> {
  children: string;
}

/**
 * Record data in the direction it is written, whatever the UI's: an English
 * transcript inside the Arabic UI starts at the left, an Arabic reaction
 * inside the English UI at the right. English drug names inside an Arabic
 * sentence already read correctly once the sentence itself is right-to-left.
 */
export function BidiText({ children, ...rest }: BidiTextProps) {
  const { lang } = useHealth();
  // The direction view sets both the text's writing direction and where its lines start.
  return (
    <DirectionView direction={textDirection(children, lang)}>
      <AppText {...rest}>{children}</AppText>
    </DirectionView>
  );
}
