import type { Locale } from '@/marketing/i18n/locale';
import { locale } from '@/marketing/i18n/browser';

// The contact form's messages, the same as the company site's. Each message
// requires both languages.
export const messages = {
  close: { en: 'Close', ja: '閉じる' },
  contactTitle: {
    en: 'Tell us what you are building',
    ja: '開発中のサービスについてお聞かせください',
  },
  contactCopy: {
    en: 'The form opens your email app with the message ready to send. You can also write to',
    ja: '入力内容をまとめてメールアプリを開きます。次のアドレスにも直接ご連絡いただけます：',
  },
  contactForm: { en: 'Contact sales form', ja: '営業へのお問い合わせフォーム' },
  name: { en: 'Name', ja: '氏名' },
  workEmail: { en: 'Work email', ja: '仕事用メールアドレス' },
  companyName: { en: 'Company', ja: '会社名' },
  projectDetails: { en: 'Project details', ja: 'プロジェクトの詳細' },
  projectPlaceholder: {
    en: 'What are you building, and where can Seams help?',
    ja: '開発中のサービスや、Seamsに相談したいことをお聞かせください。',
  },
  emailSales: { en: 'Email sales', ja: 'メールで営業に相談' },
  salesSubject: {
    en: 'Sales inquiry from {name} at {company}',
    ja: '{company}の{name}様からのお問い合わせ',
  },
} satisfies Record<string, Record<Locale, string>>;

export type MessageKey = keyof typeof messages;

// Language changes use document navigation, so the page keeps one locale.
export function t(key: MessageKey): string {
  return messages[key][locale];
}
