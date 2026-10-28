import type { UploadFile } from './health.types';

/** iOS and Android: React Native's FormData streams a local file from its URI. */
export async function appendFile(form: FormData, field: string, file: UploadFile): Promise<void> {
  form.append(field, { uri: file.uri, name: file.name, type: file.mimeType } as unknown as Blob);
}
