import { MOCK_MEDIA } from './mockData';

/**
 * The files behind the mock's `mock://` addresses: sample summary audio and
 * document photos. Only ever required behind the mock-build check in
 * media.ts, so a release build that talks to the real backend never
 * bundles them.
 */
export const MOCK_FILES: Readonly<Record<string, number>> = {
  [MOCK_MEDIA.audioAhmedEn]: require('../../assets/audio/health-summary-ahmed-en.wav'),
  [MOCK_MEDIA.audioAhmedAr]: require('../../assets/audio/health-summary-ahmed-ar.wav'),
  [MOCK_MEDIA.audioLailaEn]: require('../../assets/audio/health-summary-laila-en.wav'),
  [MOCK_MEDIA.audioLailaAr]: require('../../assets/audio/health-summary-laila-ar.wav'),
  [MOCK_MEDIA.prescription]: require('../../assets/images/health/sample-prescription.jpg'),
  [MOCK_MEDIA.labReport]: require('../../assets/images/health/sample-lab-report.jpg'),
  [MOCK_MEDIA.discharge]: require('../../assets/images/health/sample-discharge.jpg'),
};
