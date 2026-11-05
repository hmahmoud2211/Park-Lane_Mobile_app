import type { NoAnswer } from './request';

export interface TimedUploadOptions<T> {
  form: FormData;
  headers: Record<string, string>;
  timeoutMs: number;
  /** The caller's cancel; aborting it aborts the upload. */
  signal?: AbortSignal;
  /** The share of the form sent so far, 0-1, whenever the platform can tell. */
  onProgress?: (fraction: number) => void;
  /** The error to throw when no answer came back; see timedFetch. */
  noAnswer: (why: NoAnswer) => Error;
  /** Reads the answer: its status and raw body. */
  read: (status: number, body: string) => T;
}

/**
 * POSTs a multipart form. XMLHttpRequest rather than timedFetch, because fetch reports no
 * upload progress; otherwise it behaves the same: a timeout, the caller's cancel, and the
 * client's own wording for each failure.
 */
export function timedUpload<T>(url: string, options: TimedUploadOptions<T>): Promise<T> {
  const { form, headers, timeoutMs, signal, onProgress, noAnswer, read } = options;

  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.timeout = timeoutMs;
    for (const [name, value] of Object.entries(headers)) {
      xhr.setRequestHeader(name, value);
    }
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress?.(event.loaded / event.total);
    };

    const abort = () => xhr.abort();
    signal?.addEventListener('abort', abort, { once: true });
    const settle = () => signal?.removeEventListener('abort', abort);
    const fail = (why: NoAnswer) => {
      settle();
      reject(noAnswer(why));
    };

    xhr.onload = () => {
      settle();
      try {
        resolve(read(xhr.status, xhr.responseText));
      } catch (error) {
        reject(error);
      }
    };
    xhr.onerror = () => fail({ timedOut: false, aborted: false });
    xhr.ontimeout = () => fail({ timedOut: true, aborted: false });
    xhr.onabort = () => fail({ timedOut: false, aborted: true });
    xhr.send(form);
  });
}
