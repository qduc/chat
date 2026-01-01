/**
 * Audio utilities
 * - Encode audio files as base64 for OpenRouter/OpenAI-style `input_audio` parts
 * - Infer audio format strings expected by providers
 */

import type { AudioAttachment, InputAudioContent } from './types';

const FORMAT_BY_EXT: Record<string, string> = {
  wav: 'wav',
  mp3: 'mp3',
  aiff: 'aiff',
  aif: 'aiff',
  aac: 'aac',
  ogg: 'ogg',
  oga: 'ogg',
  flac: 'flac',
  m4a: 'm4a',
  pcm16: 'pcm16',
  pcm24: 'pcm24',
};

const FORMAT_BY_MIME: Record<string, string> = {
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/aiff': 'aiff',
  'audio/x-aiff': 'aiff',
  'audio/aac': 'aac',
  'audio/ogg': 'ogg',
  'audio/flac': 'flac',
  'audio/mp4': 'm4a',
};

export function inferAudioFormat(file: File): string | undefined {
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  if (ext && FORMAT_BY_EXT[ext]) return FORMAT_BY_EXT[ext];

  const mime = (file.type || '').toLowerCase();
  if (mime && FORMAT_BY_MIME[mime]) return FORMAT_BY_MIME[mime];

  return undefined;
}

export function isAudioFile(file: File): boolean {
  if (file.type && file.type.startsWith('audio/')) return true;
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  return Boolean(ext && FORMAT_BY_EXT[ext]);
}

export async function encodeFileToBase64(file: File): Promise<string> {
  // Read as data URL and strip prefix. This avoids manual ArrayBuffer->base64 conversion.
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error('Failed to read file'));
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const comma = result.indexOf(',');
      if (comma === -1) {
        // Unexpected, but attempt to return whole string if it looks like base64
        return resolve(result);
      }
      return resolve(result.slice(comma + 1));
    };
    reader.readAsDataURL(file);
  });
}

export function audioPartToDataUrl(part: InputAudioContent): string | null {
  const payload =
    (part as any).input_audio && typeof (part as any).input_audio === 'object'
      ? (part as any).input_audio
      : (part as any).inputAudio;

  const data = typeof payload?.data === 'string' ? payload.data : '';
  const format = typeof payload?.format === 'string' ? payload.format : '';
  if (!data || !format) return null;

  // Use a best-effort mime. Browsers handle a lot of audio/* values.
  const mime = format === 'mp3' ? 'audio/mpeg' : format === 'wav' ? 'audio/wav' : `audio/${format}`;
  return `data:${mime};base64,${data}`;
}

export async function attachmentToInputAudioPart(
  attachment: AudioAttachment
): Promise<InputAudioContent> {
  const format = attachment.format || inferAudioFormat(attachment.file) || 'wav';
  const data = await encodeFileToBase64(attachment.file);

  // Prefer OpenAI-compatible snake_case payload shape.
  return {
    type: 'input_audio',
    input_audio: {
      data,
      format,
    },
  };
}
