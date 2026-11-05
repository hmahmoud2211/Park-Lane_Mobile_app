import type { ReactNode } from 'react';

import { layout } from '../../theme';
import { AppButton } from '../common/AppButton';
import { Notice } from './Notice';

export interface ErrorNoticeProps {
  title: string;
  /** The error itself, e.g. the backend's message. */
  children: ReactNode;
  retryLabel: string;
  onRetry: () => void;
  /** The retry button's height; the inner screens' button height by default. */
  buttonHeight?: number;
}

/** A load that failed, with a button to try again. */
export function ErrorNotice({ title, children, retryLabel, onRetry, buttonHeight = layout.innerScreen.buttonHeight }: ErrorNoticeProps) {
  return (
    <Notice tone="error" title={title} actions={<AppButton title={retryLabel} variant="secondary" height={buttonHeight} onPress={onRetry} />}>
      {children}
    </Notice>
  );
}
