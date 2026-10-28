import { useState } from 'react';

import { useHealth } from '../../hooks/useHealth';
import type { HealthDocument } from '../../services/health/health.types';
import { openOriginal } from '../../services/health/localFiles';
import { mediaSource } from '../../services/health/media';
import { Notice } from '../parking/Notice';
import { ParkingButton } from '../parking/ParkingButton';
import { ZoomableImage } from './ZoomableImage';

export interface OriginalFileCopy {
  noLongerStored: string;
  noLongerStoredBody: string;
  pageLabel: string;
  zoomIn: string;
  zoomOut: string;
  openFile: string;
  openFileBody: string;
  openFailed: string;
}

export const originalFileCopy: Record<'en' | 'ar', OriginalFileCopy> = {
  en: {
    noLongerStored: 'Original file no longer stored',
    noLongerStoredBody: 'The text read from it and the items you confirmed are kept.',
    pageLabel: 'Original document',
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    openFile: 'Open original file',
    openFileBody: 'This file can’t be shown here. Open it to compare.',
    openFailed: 'The file couldn’t be opened. Try again.',
  },
  ar: {
    noLongerStored: 'لم يعد الملف الأصلي محفوظًا',
    noLongerStoredBody: 'ما زال النص المقروء منه والعناصر التي أكدتها محفوظين.',
    pageLabel: 'المستند الأصلي',
    zoomIn: 'تكبير',
    zoomOut: 'تصغير',
    openFile: 'فتح الملف الأصلي',
    openFileBody: 'لا يمكن عرض هذا الملف هنا. افتحه للمقارنة.',
    openFailed: 'تعذّر فتح الملف. حاول مرة أخرى.',
  },
};

/**
 * The document as uploaded: a zoomable image, or for a PDF a button that
 * opens it in the system viewer. The backend may have deleted it after
 * confirmation; that is a normal state, not an error.
 */
export function OriginalFile({ doc }: { doc: Pick<HealthDocument, 'id' | 'file_url'> }) {
  const { lang, service } = useHealth();
  const copy = originalFileCopy[lang];
  const [notImage, setNotImage] = useState(false);
  const [opening, setOpening] = useState(false);
  const [openFailed, setOpenFailed] = useState(false);

  if (!doc.file_url) {
    return (
      <Notice tone="info" title={copy.noLongerStored}>
        {copy.noLongerStoredBody}
      </Notice>
    );
  }

  if (notImage) {
    const url = doc.file_url;
    return (
      <Notice
        tone={openFailed ? 'warning' : 'info'}
        actions={
          <ParkingButton
            compact
            icon="document-outline"
            label={copy.openFile}
            loading={opening}
            onPress={() => {
              setOpening(true);
              setOpenFailed(false);
              openOriginal(url, service.mediaHeaders(), `${doc.id}.pdf`)
                .catch(() => setOpenFailed(true))
                .finally(() => setOpening(false));
            }}
          />
        }
      >
        {openFailed ? copy.openFailed : copy.openFileBody}
      </Notice>
    );
  }

  return (
    <ZoomableImage
      source={mediaSource(doc.file_url, service.mediaHeaders())}
      accessibilityLabel={copy.pageLabel}
      zoomInLabel={copy.zoomIn}
      zoomOutLabel={copy.zoomOut}
      onError={() => setNotImage(true)}
    />
  );
}
