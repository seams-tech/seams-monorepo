import type { Locale } from '@/marketing/i18n/locale';
import { formatPricingMessage } from './prices';

// The pricing page's messages. Each message requires both languages; prices are
// placeholders that formatPricingMessage fills for the locale.
export const messages = {
  pricingTitle: {
    en: 'Free to start. Pay per active user.',
    ja: '無料で開始。アクティブユーザー数に応じた料金。',
  },
  pricingDescription: {
    en: 'The first 300 users are free, and development is always free. As you grow, you pay per active user, with signing included.',
    ja: '最初の300ユーザーまでは無料。開発環境はいつでも無料です。利用が増えたら、署名を含むアクティブユーザー数に応じた料金で使えます。',
  },
  pricingPageTitle: { en: 'Pricing | Seams Wallet', ja: '料金 | Seams Wallet' },
  free: { en: 'Free', ja: 'Free' },
  freePrice: { en: '{zero}', ja: '{zero}' },
  growthPrice: { en: '{growthBase}', ja: '{growthBase}' },
  proPrice: { en: '{proBase}', ja: '{proBase}' },
  perMonth: { en: 'per month', ja: '月額' },
  freeSummary: {
    en: 'For launches and small apps, in production.',
    ja: '新しいサービスや小規模アプリの本番運用に。',
  },
  freeUsers: { en: 'Up to 300 monthly active users', ja: '月間アクティブユーザー300人まで' },
  freeSignatures: { en: '30,000 signatures a month', ja: '月間30,000回の署名' },
  walletFeatures: {
    en: 'Passkeys, Email OTP, and split-key wallets',
    ja: 'パスキー、メールOTP、分散鍵ウォレット',
  },
  oneFree: { en: 'One free plan per organization', ja: '1組織につきFreeプラン1つ' },
  cardAfter30: {
    en: 'Card required after 30 days, not charged',
    ja: '30日後からカード登録が必要。無料枠内は請求なし',
  },
  startBuilding: { en: 'Start building', ja: '開発を始める' },
  growthSummary: {
    en: 'For apps with a growing user base.',
    ja: 'ユーザー数が増えているアプリに。',
  },
  growthUsers: {
    en: '5,000 monthly active users included',
    ja: '月間アクティブユーザー5,000人を含む',
  },
  growthOverage: {
    en: '{growthPerUser} per active user above 5,000',
    ja: '5,000人を超えるアクティブユーザーは1人あたり約{growthPerUser}',
  },
  pooledSignatures: {
    en: '300 signatures per user each month, pooled',
    ja: 'ユーザー1人あたり月300回の署名をアプリ全体で共有',
  },
  signatureOverage: {
    en: '{growthPer1000Signatures} per 1,000 signatures above the pool',
    ja: '共有枠を超える署名は1,000回あたり約{growthPer1000Signatures}',
  },
  proSummary: {
    en: 'For apps at scale that need an SLA.',
    ja: '利用者が多く、稼働保証が必要なアプリに。',
  },
  proUsers: {
    en: '100,000 monthly active users included',
    ja: '月間アクティブユーザー100,000人を含む',
  },
  proOverage: {
    en: '{proPerUser} per active user above 100,000',
    ja: '100,000人を超えるアクティブユーザーは1人あたり約{proPerUser}',
  },
  proSignatureOverage: {
    en: '{proPer1000Signatures} per 1,000 signatures above the pool',
    ja: '共有枠を超える署名は1,000回あたり約{proPer1000Signatures}',
  },
  proSupport: { en: 'Uptime SLA and priority support', ja: '稼働率SLAと優先サポート' },
  custom: { en: 'Custom', ja: '個別見積もり' },
  committedVolume: { en: 'committed volume', ja: '利用量の確約に応じて' },
  enterpriseSummary: {
    en: 'For large apps and merchant fleets.',
    ja: '大規模アプリや複数の加盟店を運営する事業者に。',
  },
  volumePricing: { en: 'Volume pricing on committed usage', ja: '確約した利用量に応じた料金' },
  enterpriseUsers: {
    en: 'From {enterprisePerUser} per active user above 5,000',
    ja: '5,000人を超えるアクティブユーザーは1人あたり約{enterprisePerUser}から',
  },
  enterpriseSignatures: {
    en: 'Signatures from {enterprisePer1000Signatures} per 1,000',
    ja: '署名1,000回あたり約{enterprisePer1000Signatures}から',
  },
  rollout: { en: 'Rollout planning with our team', ja: '導入計画をチームが支援' },
  contactSales: { en: 'Contact sales', ja: '営業に相談' },
  freeTeaser: { en: 'Up to 300 active users', ja: 'アクティブユーザー300人まで' },
  growthTeaser: { en: '5,000 users included', ja: '5,000ユーザーを含む' },
  proTeaser: { en: '100,000 users included', ja: '100,000ユーザーを含む' },
  enterpriseTeaser: { en: 'Committed volume', ja: '確約した利用量に応じて' },
  buildSdk: { en: 'Build with the Seams SDK', ja: 'Seams SDKで開発を始める' },
  bannerCopy: {
    en: 'Passkey sign-in, split-key wallets, and account recovery. Pick a plan to start.',
    ja: 'パスキーでのログイン、分散鍵ウォレット、アカウント復旧。プランを選んで始めましょう。',
  },
  startPlan: { en: 'Start with a plan', ja: 'プランを選んで始める' },
  signupDialogLabel: { en: 'Sign in to start {plan}', ja: '{plan}を始めるためにサインイン' },
  signupFrameTitle: { en: 'Seams Console sign-in', ja: 'Seams Consoleへのサインイン' },
  close: { en: 'Close', ja: '閉じる' },
  plans: { en: 'Plans', ja: 'プラン' },
  poolNote: {
    en: 'Paid plans include 300 monthly signatures per active user, pooled across your app.',
    ja: '有料プランでは、アクティブユーザー1人につき月300回の署名をアプリ全体で共有できます。',
  },
  sdkNote: {
    en: 'Full SDK on every plan. Free development. Gas and chain fees at cost, with no markup.',
    ja: '全プランでSDK全機能。開発環境は無料。ガス代・チェーン手数料は上乗せなしの実費。',
  },
  exampleTitle: { en: 'What a month costs as you grow', ja: 'ユーザー数に応じた月額料金の例' },
  exampleCopy: {
    en: 'An app where each user signs 10 times a day. Every user includes 300 signatures a month, so you pay for active users only. Each row shows the plan with the lowest price.',
    ja: 'ユーザー1人が1日10回署名するアプリの例です。各ユーザーに月300回の署名を含むため、アクティブユーザー数に応じた料金だけがかかります。各行には最も安いプランを示します。',
  },
  monthlyUsers: { en: 'Monthly active users', ja: '月間アクティブユーザー数' },
  plan: { en: 'Plan', ja: 'プラン' },
  monthlyPrice: { en: 'Price per month', ja: '月額料金' },
  estimateTitle: { en: 'Estimate your monthly price', ja: '月額料金を試算する' },
  estimateCopy: {
    en: 'Set your active users and how often they sign. Committed volume lowers the price.',
    ja: 'アクティブユーザー数と署名の頻度を指定してください。利用量の確約で料金を抑えられます。',
  },
  signaturesPerDay: { en: 'Signatures per user per day', ja: 'ユーザー1人あたりの1日の署名回数' },
  usersValue: { en: '{count} users', ja: '{count}人' },
  signaturesValue: { en: '{count} signatures per day', ja: '1日{count}回の署名' },
  monthlySignatures: { en: '{count} signatures a month.', ja: '月間{count}回の署名。' },
  insideFree: {
    en: 'Inside the Free plan: 300 users and 30,000 signatures a month.',
    ja: 'Freeプランの範囲内です。月300ユーザー、30,000回の署名まで無料です。',
  },
  abovePool: {
    en: '{count} are above the pool of 300 per user.',
    ja: '1人あたり300回の共有枠を{count}回超えています。',
  },
  insidePool: {
    en: 'All of them are inside the pool of 300 per user.',
    ja: 'すべて1人あたり300回の共有枠内です。',
  },
  growthBase: {
    en: 'Growth base, 5,000 users included',
    ja: 'Growth基本料金、5,000ユーザーを含む',
  },
  usersLine: {
    en: 'Users above 5,000 at {growthPerUser}',
    ja: '5,000人を超えるユーザー、1人あたり約{growthPerUser}',
  },
  signaturesLine: {
    en: 'Signatures above the pool at {growthPer1000Signatures} per 1,000',
    ja: '共有枠を超える署名、1,000回あたり約{growthPer1000Signatures}',
  },
  proBaseLine: { en: 'Pro base, 100,000 users included', ja: 'Pro基本料金、100,000ユーザーを含む' },
  proUsersLine: {
    en: 'Users above 100,000 at {proPerUser}',
    ja: '100,000人を超えるユーザー、1人あたり約{proPerUser}',
  },
  proSignaturesLine: {
    en: 'Signatures above the pool at {proPer1000Signatures} per 1,000',
    ja: '共有枠を超える署名、1,000回あたり約{proPer1000Signatures}',
  },
  freeMonthly: { en: 'Free plan, per month', ja: 'Freeプラン、月額' },
  growthMonthly: { en: 'Growth, per month', ja: 'Growth、月額' },
  proMonthly: { en: 'Pro, per month', ja: 'Pro、月額' },
  lowestSelfServe: { en: 'Lowest self-serve price', ja: 'セルフサービスで最安' },
  enterpriseFrom: { en: 'Enterprise, from', ja: 'Enterpriseの目安' },
  enterpriseFine: {
    en: 'Enterprise starts at {enterprisePerUser} per active user above 5,000 and {enterprisePer1000Signatures} per 1,000 signatures above the pool. Volume pricing on committed usage is quoted by our team.',
    ja: 'Enterpriseは5,000人を超えるアクティブユーザー1人あたり約{enterprisePerUser}から、共有枠を超える署名1,000回あたり約{enterprisePer1000Signatures}からです。確約する利用量に応じてチームがお見積もりします。',
  },
  faqTitle: { en: 'Frequently asked questions', ja: 'よくある質問' },
  faqUserQ: {
    en: 'What counts as a monthly active user?',
    ja: '月間アクティブユーザーとは何ですか？',
  },
  faqUserA: {
    en: 'A user who signs in during the month, or who gets a new wallet that month. A user counts once, however many times they sign in.',
    ja: 'その月にログインしたユーザー、または新しいウォレットを作成したユーザーです。ログイン回数にかかわらず、1ユーザーとして数えます。',
  },
  faqPoolQ: {
    en: 'What if my users sign more than 10 times a day?',
    ja: 'ユーザーが1日に10回以上署名する場合は？',
  },
  faqPoolA: {
    en: 'Signatures are pooled across your app: 300 for each active user each month. Busy users are covered while the average stays inside the pool. Signatures above the pool cost {growthPer1000Signatures} per 1,000.',
    ja: 'アクティブユーザー1人あたり月300回の署名を、アプリ全体で共有します。平均が共有枠内なら、一部のユーザーの署名が多くても追加料金はありません。共有枠を超えた分は1,000回あたり約{growthPer1000Signatures}です。',
  },
  faqDevQ: { en: 'Do development environments count?', ja: '開発環境の利用も課金対象ですか？' },
  faqDevA: {
    en: 'No. Development environments run on testnets, with no limits and no charge. Only production users and signatures count.',
    ja: '開発環境はテストネットで動作し、利用上限も料金もありません。本番環境のユーザーと署名だけが課金対象です。',
  },
  faqGasQ: { en: 'Do you charge for gas?', ja: 'ガス代はかかりますか？' },
  faqGasA: {
    en: 'Gas and chain fees pass through at cost. We add no margin to them.',
    ja: 'ガス代とチェーン手数料は実費で請求します。上乗せはありません。',
  },
  faqGrowthQ: {
    en: 'What happens when my app grows past the free plan?',
    ja: '無料枠を超えるとどうなりますか？',
  },
  faqGrowthA: {
    en: 'We warn you at 80% of a free limit: 300 active users or 30,000 signatures in a month. With a card on file, your app moves to Growth at the limit, with no pause: {growthBase} a month, with 5,000 users included. Without a card, production sign-ups and signing pause at the limit until you add one. Recovery and key export stay open, with rate limits, so your users keep access to their funds.',
    ja: '無料枠は月300アクティブユーザーまたは30,000回の署名で、上限の80%に達すると通知します。カード登録済みなら、上限でGrowthへ移行し、サービスは継続します。月額{growthBase}で5,000ユーザーを含みます。カード未登録なら、登録するまで本番の新規登録と署名を一時停止します。復旧と鍵のエクスポートはレート制限付きで利用でき、ユーザーは資金へのアクセスを維持できます。',
  },
  faqCardQ: {
    en: 'Do I need a card for the free plan?',
    ja: 'Freeプランにもカード登録が必要ですか？',
  },
  faqCardA: {
    en: 'Not at first. From 30 days after you create your organization, production needs a card on file. We do not charge it while you stay inside the free limits. Development environments never need a card.',
    ja: '開始時には不要です。組織の作成から30日後より、本番環境にはカード登録が必要です。無料枠内なら請求しません。開発環境にはカード登録は不要です。',
  },
  faqOneQ: { en: 'Can I use more than one free plan?', ja: '複数のFreeプランを使えますか？' },
  faqOneA: {
    en: 'No. Each organization has one free plan, and each app origin can belong to only one free organization.',
    ja: '1組織につきFreeプランは1つです。各アプリのオリジンは、無料プランを使う1つの組織にのみ所属できます。',
  },
} satisfies Record<string, Record<Locale, string>>;

export type MessageKey = keyof typeof messages;
export type Translate = (key: MessageKey) => string;

export function translate(locale: Locale, key: MessageKey): string {
  return formatPricingMessage(locale, messages[key][locale]);
}
