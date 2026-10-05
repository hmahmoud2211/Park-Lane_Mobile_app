import { useCallback, useEffect, useRef, useState } from 'react';

import type { AnswerSummary } from '../services/assistant/assistant.types';
import { AssistantApiError, sendChatMessage } from '../services/assistant/assistantApi';

/**
 * `answered` and `declined` are both replies from the assistant (`ok` true
 * or false); `failed` means it could not be reached, and offers a retry.
 */
export type ChatMessageStatus = 'sent' | 'answered' | 'declined' | 'failed';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  status: ChatMessageStatus;
  createdAt: number;
  summary?: AnswerSummary;
  /** On a failed reply: the question to send again. */
  retryText?: string;
}

let sequence = 0;
const nextId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(sequence++).toString(36)}`;

/** Memory needs a stable key; guests get one for as long as the app runs. */
const guestUserId = `guest-${Math.random().toString(36).slice(2, 10)}`;

function failureText(error: unknown): string {
  if (!(error instanceof AssistantApiError)) {
    return 'Something went wrong. Please try again.';
  }
  switch (error.kind) {
    case 'network':
      return "I couldn't reach the assistant. Check your connection and try again.";
    case 'timeout':
      return 'That took longer than expected. Please try again.';
    case 'not_found':
      return "Your resident profile wasn't found. Try signing in again.";
    case 'validation':
      return "That request couldn't be processed. Please rephrase and try again.";
    default:
      return 'The assistant ran into a problem. Please try again in a moment.';
  }
}

/**
 * The text conversation (FRONTEND_INTEGRATION.md §4.2): one question at a
 * time, with `session_id` carried forward so follow-ups ("and yesterday?")
 * keep their context. Switching resident starts a new conversation.
 */
export function useAssistantChat(residentId: number | null) {
  const [messages, setMessages] = useState<readonly ChatMessage[]>([]);
  const [pending, setPending] = useState(false);
  const sessionId = useRef<string | undefined>(undefined);
  const inFlight = useRef<AbortController | null>(null);

  const ask = useCallback(
    async (text: string) => {
      const controller = new AbortController();
      inFlight.current = controller;
      setPending(true);
      try {
        const reply = await sendChatMessage(
          {
            message: text,
            ...(residentId != null ? { resident_id: residentId } : { user_id: guestUserId }),
            ...(sessionId.current ? { session_id: sessionId.current } : null),
          },
          controller.signal,
        );
        if (controller.signal.aborted) {
          return;
        }
        sessionId.current = reply.session_id || sessionId.current;
        setMessages((list) => [
          ...list,
          {
            id: nextId('a'),
            role: 'assistant',
            text: reply.answer?.trim() || 'I could not find an answer to that.',
            status: reply.ok ? 'answered' : 'declined',
            createdAt: Date.now(),
            summary: reply.summary,
          },
        ]);
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }
        setMessages((list) => [
          ...list,
          {
            id: nextId('a'),
            role: 'assistant',
            text: failureText(error),
            status: 'failed',
            createdAt: Date.now(),
            retryText: text,
          },
        ]);
      } finally {
        if (inFlight.current === controller) {
          inFlight.current = null;
          setPending(false);
        }
      }
    },
    [residentId],
  );

  /** Wait for the reply before sending the next question, as the backend asks. */
  const send = useCallback(
    (raw: string) => {
      const text = raw.trim();
      if (!text || inFlight.current) {
        return false;
      }
      setMessages((list) => [
        ...list,
        { id: nextId('u'), role: 'user', text, status: 'sent', createdAt: Date.now() },
      ]);
      void ask(text);
      return true;
    },
    [ask],
  );

  /** Re-asks the question behind a failed reply, replacing the failure. */
  const retry = useCallback(
    (messageId: string) => {
      if (inFlight.current) {
        return;
      }
      const failed = messages.find((message) => message.id === messageId);
      if (!failed?.retryText) {
        return;
      }
      setMessages((list) => list.filter((message) => message.id !== messageId));
      void ask(failed.retryText);
    },
    [ask, messages],
  );

  const reset = useCallback(() => {
    inFlight.current?.abort();
    inFlight.current = null;
    sessionId.current = undefined;
    setPending(false);
    setMessages([]);
  }, []);

  // A conversation belongs to one resident.
  const residentRef = useRef(residentId);
  useEffect(() => {
    if (residentRef.current !== residentId) {
      residentRef.current = residentId;
      reset();
    }
  }, [residentId, reset]);

  useEffect(() => () => inFlight.current?.abort(), []);

  return { messages, pending, send, retry, reset };
}
