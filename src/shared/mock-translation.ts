import type { TargetLanguage, TranslationRequest, TranslationResult } from "./contracts";

interface MockEntry {
  en: string;
  vi: string;
  compact?: Partial<Record<TargetLanguage, string>>;
}

const MOCK_DICTIONARY: Record<string, MockEntry> = {
  会社情報: { en: "Company", vi: "Thông tin công ty" },
  お問い合わせはこちら: {
    en: "Contact us",
    vi: "Liên hệ với chúng tôi",
    compact: { en: "Contact", vi: "Liên hệ" },
  },
  保存する: { en: "Save", vi: "Lưu" },
  詳細を見る: { en: "View details", vi: "Xem chi tiết", compact: { en: "Details", vi: "Chi tiết" } },
  利用規約: { en: "Terms", vi: "Điều khoản" },
  担当者: { en: "Owner", vi: "Người phụ trách", compact: { vi: "Phụ trách" } },
  進捗状況: { en: "Status", vi: "Tiến độ" },
  説明文: { en: "Description", vi: "Mô tả" },
  新しい通知: { en: "New notification", vi: "Thông báo mới" },
  確認して送信: {
    en: "Review and send",
    vi: "Xem lại và gửi",
    compact: { en: "Send", vi: "Gửi" },
  },
  "長い説明テキストです。": {
    en: "This is a longer description that should remain readable while the surrounding card stays coherent.",
    vi: "Đây là phần mô tả dài cần giữ khả năng đọc trong khi bố cục thẻ vẫn nhất quán.",
  },
};

export async function mockTranslateBatch(
  requests: TranslationRequest[],
  targetLanguage: TargetLanguage,
): Promise<TranslationResult[]> {
  return requests.map((request) => {
    const entry = MOCK_DICTIONARY[request.source];
    if (!entry) {
      return { anchorId: request.anchorId, full: request.source, compact: request.source };
    }
    return {
      anchorId: request.anchorId,
      full: entry[targetLanguage],
      compact: entry.compact?.[targetLanguage] ?? entry[targetLanguage],
    };
  });
}

export const mockDictionary = MOCK_DICTIONARY;
