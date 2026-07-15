// 병원 제출용 PDF 생성/공유 — expo-print(HTML→PDF) + expo-sharing 래퍼
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import type { DailyRecord, ReportInput } from '../types';
import { buildReportHtml } from './reportHtml';

export { buildReportHtml };

// PDF 렌더러(WebView)는 로컬 file:// 이미지를 차단하므로 data URI로 임베드.
// https(서명 URL)와 data:는 그대로 통과.
const toDataUri = async (uri: string): Promise<string> => {
  if (uri.startsWith('http') || uri.startsWith('data:')) return uri;
  const ext = uri.split('?')[0].split('.').pop()?.toLowerCase();
  const mime = ext === 'png' ? 'image/png' : 'image/jpeg';
  const b64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
  return `data:${mime};base64,${b64}`;
};

const embedPhotos = async (records: DailyRecord[]): Promise<DailyRecord[]> =>
  Promise.all(records.map(async (r) =>
    r.photoUris.length === 0
      ? r
      : { ...r, photoUris: await Promise.all(r.photoUris.map(toDataUri)) }));

export const generateReportPdf = async (input: ReportInput): Promise<{ uri: string }> => {
  const html = buildReportHtml({ ...input, records: await embedPhotos(input.records) });
  const { uri } = await Print.printToFileAsync({ html, base64: false });
  return { uri };
};

export const shareReportPdf = async (uri: string): Promise<void> => {
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, {
      mimeType: 'application/pdf',
      dialogTitle: '병원 제출용 레포트 공유',
      UTI: 'com.adobe.pdf',
    });
  }
};
