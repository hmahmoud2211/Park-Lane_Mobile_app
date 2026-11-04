import * as Clipboard from 'expo-clipboard';
import { Linking, Platform, Share } from 'react-native';

/**
 * Sharing a pass, always started by the user tapping a button.
 *
 * The result says only what is known: that the share sheet was used or
 * dismissed, or that the text was copied. Nothing here can tell whether a
 * message was actually delivered, so callers never report "sent".
 */
export type ShareOutcome = 'shared' | 'dismissed' | 'copied' | 'failed';

interface WebShareNavigator {
  share?: (data: { title?: string; text?: string; url?: string }) => Promise<void>;
}

export async function shareText(title: string, text: string, url?: string): Promise<ShareOutcome> {
  if (Platform.OS === 'web') {
    const nav = (typeof navigator !== 'undefined' ? navigator : undefined) as WebShareNavigator | undefined;
    if (nav?.share) {
      try {
        await nav.share({ title, text, url });
        return 'shared';
      } catch (error) {
        if ((error as { name?: string }).name === 'AbortError') {
          return 'dismissed';
        }
      }
    }
    // No share sheet in this browser: fall back to copying.
    return (await copyText(url ? `${text}\n${url}` : text)) ? 'copied' : 'failed';
  }
  try {
    const result = await Share.share({ title, message: url && Platform.OS === 'android' ? `${text}\n${url}` : text, url });
    return result.action === Share.dismissedAction ? 'dismissed' : 'shared';
  } catch {
    return 'failed';
  }
}

export async function copyText(text: string): Promise<boolean> {
  try {
    return await Clipboard.setStringAsync(text);
  } catch {
    return false;
  }
}

export function shareOutcomeMessage(outcome: ShareOutcome, what: string): string {
  switch (outcome) {
    case 'shared':
      return `${what} handed to your share menu. Delivery depends on the app you chose.`;
    case 'dismissed':
      return 'Share cancelled. Nothing was shared.';
    case 'copied':
      return `${what} copied. Paste it into a message to share it.`;
    case 'failed':
      return `Could not share or copy the ${what.toLowerCase()} on this device.`;
  }
}

/**
 * A phone number as international digits, e.g. "0100 123 4567" with country
 * code 20 becomes "201001234567". Undefined when there are no digits.
 */
export function internationalDigits(phone: string | undefined, countryCode: string): string | undefined {
  const trimmed = phone?.trim() ?? '';
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return undefined;
  if (trimmed.startsWith('+')) return digits;
  if (digits.startsWith('00')) return digits.slice(2);
  if (digits.startsWith('0')) return countryCode + digits.slice(1);
  return digits;
}

/** WhatsApp with the message typed in. Without a number, WhatsApp asks who to send it to. */
export function whatsappUrl(text: string, digits?: string): string {
  return `https://wa.me/${digits ?? ''}?text=${encodeURIComponent(text)}`;
}

/**
 * Opens a link in the app that handles it: WhatsApp, the messages app or the
 * browser. On web, web pages open in a new tab and other schemes (e.g. tel:)
 * hand over from this page, so no empty tab is left behind.
 */
export async function openLink(url: string): Promise<boolean> {
  try {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      if (/^https?:/i.test(url)) {
        window.open(url, '_blank', 'noopener');
      } else {
        window.location.href = url;
      }
      return true;
    }
    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
}

export async function openExternal(url: string): Promise<boolean> {
  try {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.open(url, '_blank', 'noopener');
      return true;
    }
    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
}
