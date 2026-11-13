import { useCallback, useRef, useState } from 'react';

import type { AiReportReason, AiReportSource } from '../../../../../shared/contracts/aiReports';
import { reportFailureOf, sendAiReport, type ReportFailure } from '../services/aiReportsApi';
import type { ReportPhase } from '../types';

/**
 * One report being written: sends it once (a second tap while it is on its way does nothing), and holds whether it
 * went or why it did not, so the sheet can say so and offer to try again.
 */
export function useAiReport(source: AiReportSource) {
  const [phase, setPhase] = useState<ReportPhase>('idle');
  const [failure, setFailure] = useState<ReportFailure | null>(null);
  const inFlight = useRef(false);

  const send = useCallback(
    async (reason: AiReportReason, note: string, excerpt: string): Promise<boolean> => {
      if (inFlight.current) return false;
      inFlight.current = true;
      setPhase('sending');
      setFailure(null);
      try {
        await sendAiReport({ source, reason, note, excerpt });
        setPhase('sent');
        return true;
      } catch (error) {
        setFailure(reportFailureOf(error));
        setPhase('failed');
        return false;
      } finally {
        inFlight.current = false;
      }
    },
    [source],
  );

  return { phase, failure, send, sending: phase === 'sending' };
}
