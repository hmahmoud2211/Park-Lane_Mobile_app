import type { ReactNode } from 'react';

import { layout } from '../../theme';
import { AppButton } from '../common/AppButton';
import { Notice, type NoticeTone } from './Notice';

export interface ErrorNoticeProps {
  title: string;
  /** The error itself, e.g. the backend's message. */
  children: ReactNode;
  retryLabel: string;
  onRetry: () => void;
  /** The retry button's height; the inner screens' button height by default. */
  buttonHeight?: number;
  /** `warning` for a failure that passes by itself, e.g. no connection. */
  tone?: NoticeTone;
}

/** A load that failed, with a button to try again. */
export function ErrorNotice({ title, children, retryLabel, onRetry, buttonHeight = layout.innerScreen.buttonHeight, tone = 'error' }: ErrorNoticeProps) {
  return (
    <Notice tone={tone} title={title} actions={<AppButton title={retryLabel} variant="secondary" height={buttonHeight} onPress={onRetry} />}>
      {children}
    </Notice>
  );
}
