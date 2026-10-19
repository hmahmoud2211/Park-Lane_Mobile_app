import type { AppTheme } from '../types/theme.types';
import { qrPng, type PassImageContent, type SavePassOutcome } from './passImage.shared';

export type { PassImageContent, QrImageSource, SavePassOutcome } from './passImage.shared';

/**
 * Web: draws the pass as a phone-sized card (the app's navy, its type ramp,
 * the code on its white quiet zone in the cyan frame) and saves it as a PNG.
 * On a phone the share sheet opens, where "Save Image" puts the card in the
 * photos; on a computer it downloads.
 */

/** The card is a 360dp phone card drawn at 3×, type included. */
const SCALE = 3;
const CARD_WIDTH = 360 * SCALE;
const PAD = 22 * SCALE;
const GAP = 10 * SCALE;
const QR_SIZE = 220 * SCALE;
/** The white padding between the cyan frame and the code, as on screen. */
const QR_INSET = 4 * SCALE;

type TypeToken = { fontFamily: string; fontSize: number; lineHeight: number };

function weightOf(family: string, theme: AppTheme): number {
  const { fontFamily } = theme;
  if (family === fontFamily.bold) return 700;
  if (family === fontFamily.semiBold) return 600;
  if (family === fontFamily.medium) return 500;
  return 400;
}

/**
 * Inter has no Arabic letters, so Arabic is set in the system's Arabic face at
 * the token's weight (as the app's Arabic text falls back to it on screen).
 */
function fontFor(token: TypeToken, content: PassImageContent): string {
  const px = token.fontSize * SCALE;
  if (content.lang === 'ar') {
    return `${weightOf(token.fontFamily, content.theme)} ${px}px system-ui, -apple-system, "Segoe UI", "Noto Sans Arabic", sans-serif`;
  }
  return `${px}px ${token.fontFamily}, system-ui, -apple-system, "Segoe UI", sans-serif`;
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (!line || ctx.measureText(next).width <= maxWidth) {
      line = next;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * Lays the card out and, given its height, paints it. Called once to measure
 * (height null) and once to draw, so the card is exactly as tall as its text.
 */
function paint(ctx: CanvasRenderingContext2D, content: PassImageContent, qr: HTMLImageElement, height: number | null): number {
  const { theme } = content;
  const { colors, typography: type } = theme;
  const draw = height !== null;
  const rtl = content.lang === 'ar';
  const inner = CARD_WIDTH - PAD * 2;
  const startX = rtl ? CARD_WIDTH - PAD : PAD;
  ctx.direction = rtl ? 'rtl' : 'ltr';
  ctx.textBaseline = 'middle';

  if (draw) {
    const backdrop = ctx.createLinearGradient(0, 0, 0, height);
    backdrop.addColorStop(0, colors.deepNavy);
    backdrop.addColorStop(1, colors.midnightBlue);
    ctx.fillStyle = backdrop;
    ctx.fillRect(0, 0, CARD_WIDTH, height);
    // The blue glow behind the header, as on the app's backdrop.
    const glow = ctx.createRadialGradient(CARD_WIDTH / 2, 0, 0, CARD_WIDTH / 2, 0, CARD_WIDTH * 0.9);
    glow.addColorStop(0, colors.neonBlue);
    glow.addColorStop(1, colors.deepNavy);
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, CARD_WIDTH, CARD_WIDTH * 0.9);
    ctx.globalAlpha = 1;
  }

  let y = PAD;
  const text = (value: string, token: TypeToken, color: string, align: 'start' | 'center', maxWidth = inner) => {
    ctx.font = fontFor(token, content);
    const lines = wrap(ctx, value, maxWidth);
    const lineHeight = token.lineHeight * SCALE;
    if (draw) {
      ctx.fillStyle = color;
      ctx.textAlign = align;
      lines.forEach((line, i) => ctx.fillText(line, align === 'center' ? CARD_WIDTH / 2 : startX, y + lineHeight * (i + 0.5)));
    }
    y += lineHeight * lines.length;
  };

  text(content.compound, type.sectionTitle, colors.textPrimary, 'start');
  text(content.title, type.label, colors.textSupport, 'start');
  y += GAP * 1.6;
  text(content.guest, type.heroTitle, colors.textPrimary, 'start');
  text(content.when, type.body, colors.textSecondary, 'start');
  y += GAP * 2;

  const frame = QR_SIZE + QR_INSET * 2;
  const frameX = (CARD_WIDTH - frame) / 2;
  if (draw) {
    ctx.save();
    ctx.shadowColor = colors.electricCyan;
    ctx.shadowBlur = 12 * SCALE;
    roundedRect(ctx, frameX, y, frame, frame, theme.borderRadius.md * SCALE);
    ctx.fillStyle = colors.qrBackground;
    ctx.fill();
    ctx.restore();
    roundedRect(ctx, frameX, y, frame, frame, theme.borderRadius.md * SCALE);
    ctx.lineWidth = 2 * SCALE;
    ctx.strokeStyle = colors.electricCyan;
    ctx.stroke();
    ctx.drawImage(qr, frameX + QR_INSET, y + QR_INSET, QR_SIZE, QR_SIZE);
  }
  y += frame + GAP * 1.6;
  text(content.caption, type.caption, colors.textSecondary, 'center', inner * 0.9);
  y += GAP * 1.4;

  for (const fact of content.facts) {
    if (draw) {
      ctx.fillStyle = colors.dividerSubtle;
      ctx.fillRect(PAD, y, inner, SCALE / 2);
    }
    y += GAP;
    text(fact.label, type.label, colors.textSupport, 'start');
    text(fact.value, type.bodyStrong, colors.textPrimary, 'start');
    y += GAP * 0.6;
  }
  y += GAP * 1.4;
  text(content.footer, type.label, colors.textMuted, 'center');
  return Math.ceil(y + PAD);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('The QR image could not be read.'));
    image.src = src;
  });
}

async function deliver(blob: Blob, content: PassImageContent): Promise<SavePassOutcome> {
  const name = `${content.fileName}.png`;
  const file = new File([blob], name, { type: 'image/png' });
  const phone = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  if (phone && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: content.title });
      return 'shared';
    } catch (error) {
      if ((error as { name?: string }).name === 'AbortError') {
        return 'dismissed';
      }
      // The browser refused the share sheet (e.g. the tap expired while drawing): download instead.
    }
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return 'downloaded';
}

export async function savePassImage(content: PassImageContent): Promise<SavePassOutcome> {
  try {
    const base64 = await qrPng(content.qr, QR_SIZE);
    const qr = await loadImage(`data:image/png;base64,${base64}`);
    await document.fonts?.ready;

    const canvas = document.createElement('canvas');
    canvas.width = CARD_WIDTH;
    const measure = canvas.getContext('2d');
    if (!measure) return 'failed';
    const height = paint(measure, content, qr, null);
    // Resizing clears the canvas and its state, so paint from scratch.
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return 'failed';
    paint(ctx, content, qr, height);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    return blob ? await deliver(blob, content) : 'failed';
  } catch {
    return 'failed';
  }
}
