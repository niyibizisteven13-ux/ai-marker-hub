/** Client-side copies of the server types (kept separate so the browser bundle never imports server code). */
export type AttachmentKind =
  | 'document' | 'spreadsheet' | 'presentation' | 'pdf' | 'text' | 'code'
  | 'image' | 'drawing' | 'chart' | 'diagram' | 'archive' | 'model3d';

export interface AttachmentRef {
  id: string;
  name: string;
  mime: string;
  size: number;
  kind: AttachmentKind;
  url: string;
  previewUrl?: string;
  previewId?: string;
  expiresAt: string;
}

export interface SourcePassage {
  title?: string;
  publisher?: string;
  year?: number;
  page?: number;
  table?: string;
  url?: string;
  text?: string;
}
