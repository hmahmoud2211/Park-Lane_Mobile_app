import type { UploadFile } from './health.types';

/** Web: the picker hands back blob: or data: URLs, which are read into a Blob first. */
export async function appendFile(form: FormData, field: string, file: UploadFile): Promise<void> {
  const blob = await (await fetch(file.uri)).blob();
  form.append(field, blob, file.name);
}
