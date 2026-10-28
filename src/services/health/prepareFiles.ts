import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import type { UploadFile } from './health.types';
import { uploadLimits } from './healthService';
import { fileSize } from './localFiles';

export interface PickedImage {
  uri: string;
  width: number;
  height: number;
  mimeType?: string | null;
  fileName?: string | null;
  fileSize?: number | null;
}

const KEEPS_AS_IS = /^image\/(jpe?g|png)$/i;

/**
 * Readies a photo for upload: HEIC and other formats become JPEG, and
 * anything over the long-side limit is scaled down to it. Text stays sharp
 * at that size and quality, so a JPEG or PNG already within the limits is
 * sent untouched rather than compressed twice.
 */
export async function prepareImage(image: PickedImage, index: number): Promise<UploadFile> {
  const mime = image.mimeType ?? 'image/jpeg';
  const longSide = Math.max(image.width, image.height);
  const knownSize = image.fileSize ?? (await fileSize(image.uri));
  if (KEEPS_AS_IS.test(mime) && longSide > 0 && longSide <= uploadLimits.maxImageSide && knownSize <= uploadLimits.maxFileBytes) {
    return { uri: image.uri, name: image.fileName ?? `page-${index + 1}.${mime.endsWith('png') ? 'png' : 'jpg'}`, mimeType: mime, size: knownSize };
  }

  let width = image.width;
  let height = image.height;
  if (!width || !height) {
    const probe = await ImageManipulator.manipulate(image.uri).renderAsync();
    width = probe.width;
    height = probe.height;
  }
  const context = ImageManipulator.manipulate(image.uri);
  if (Math.max(width, height) > uploadLimits.maxImageSide) {
    context.resize(width >= height ? { width: uploadLimits.maxImageSide, height: null } : { width: null, height: uploadLimits.maxImageSide });
  }
  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: uploadLimits.jpegQuality });
  return { uri: saved.uri, name: `page-${index + 1}.jpg`, mimeType: 'image/jpeg', size: await fileSize(saved.uri) };
}

export interface PickedDocument {
  uri: string;
  name: string;
  mimeType?: string | null;
  size?: number | null;
}

export async function prepareDocument(doc: PickedDocument): Promise<UploadFile> {
  return {
    uri: doc.uri,
    name: doc.name,
    mimeType: doc.mimeType ?? 'application/pdf',
    size: doc.size ?? (await fileSize(doc.uri)),
  };
}

export const isPdf = (file: Pick<UploadFile, 'mimeType' | 'name'>) =>
  file.mimeType === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
