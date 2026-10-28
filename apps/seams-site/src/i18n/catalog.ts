import type { Locale } from './locale';

export const messages = {
  companyName: { en: 'Company', ja: '会社名' },
  companyPageTitle: { en: 'Company | Seams', ja: '企業情報 | Seams' },
  companyTitle: {
    en: 'We build agents that run cafés and pâtisseries.',
    ja: 'カフェとパティスリーを運営するエージェントをつくる。',
  },
  companyDescription: {
    en: 'Seams makes Satyr, an ecommerce suite in which agents run the online shop, the inbox and the bake plan. The owner approves each change that matters, and every action leaves a receipt.',
    ja: 'Seamsは、エージェントがオンラインショップ、受信箱、生産計画を運営するECスイート「Satyr」をつくっています。重要な変更はオーナーが承認し、すべての操作に記録が残ります。',
  },
  contactSales: { en: 'Contact sales', ja: '営業に相談' },
  satyrCopy: {
    en: 'Agents run the online shop, menus, orders, payments and the inbox. They work in Slack and in the Portal, inside the limits that you set.',
    ja: 'エージェントがオンラインショップ、メニュー、注文、決済、受信箱を運営します。Slackとポータルで、設定した上限の範囲内で動きます。',
  },
  exploreSatyr: {
    en: 'Explore Satyr',
    ja: 'Satyrを見る',
  },
  bakeryCopy: {
    en: 'Orders and preorders become production runs. One run shows as a workflow, a timeline of ovens and staff, and a 3D view of the bakery.',
    ja: '注文と予約から生産ランをつくります。ひとつのランを、ワークフロー、オーブンとスタッフのタイムライン、ベーカリーの3Dビューで表示します。',
  },
  exploreBakery: {
    en: 'Explore Satyr Kitchen',
    ja: 'Satyr Kitchenを見る',
  },
  walletCopy: {
    en: 'A stablecoin wallet that opens with a passkey. Keys are split between the device and the server, so neither side can sign alone.',
    ja: 'パスキーで開くステーブルコインウォレットです。鍵を端末とサーバーに分散するため、どちらか一方だけでは署名できません。',
  },
  exploreWallet: {
    en: 'Explore Seams Wallet',
    ja: 'Seams Walletを見る',
  },
  ownerDecides: {
    en: 'The owner decides',
    ja: '決めるのはオーナー',
  },
  ownerDecidesCopy: {
    en: 'Agents prepare changes to the shop. An owner or admin approves each one, and a change that moves money is approved only in the Portal.',
    ja: 'エージェントはショップの変更を準備します。各変更はオーナーまたは管理者が承認し、お金が動く変更はポータルでのみ承認します。',
  },
  everyReceipt: {
    en: 'Every action has a receipt',
    ja: 'すべての操作に記録',
  },
  everyReceiptCopy: {
    en: 'Each action records who asked for it, what changed and what the provider confirmed.',
    ja: '各操作について、依頼した人、変更内容、プロバイダーが確認した結果を記録します。',
  },
  secretsOut: {
    en: 'Secrets stay out of the model',
    ja: 'シークレットはモデルに渡さない',
  },
  secretsOutCopy: {
    en: 'Agents use logins and API keys from the Vault without seeing them. No key enters a prompt or a transcript.',
    ja: 'エージェントはVaultのログイン情報やAPIキーを、中身を見ずに使います。キーがプロンプトや会話記録に入ることはありません。',
  },
  contact: { en: 'Contact', ja: 'お問い合わせ' },
  talkTeam: { en: 'Talk to the team', ja: 'チームに相談' },
  referenceCopy: {
    en: 'Concepts, guides, and the SDK reference',
    ja: '概念、ガイド、SDKリファレンス',
  },
  openSource: { en: 'Our open-source repositories', ja: 'オープンソースのリポジトリ' },
  news: { en: 'News and releases', ja: 'ニュースとリリース' },
  contactUs: { en: 'Contact us', ja: 'お問い合わせ' },
  readDocs: { en: 'Read the docs', ja: 'ドキュメントを読む' },
  productsTitle: {
    en: 'What we build',
    ja: '私たちがつくるもの',
  },
  principlesTitle: { en: 'Three rules behind every feature', ja: 'すべての機能を支える3つの原則' },
  teamReply: {
    en: 'Tell us about your shop. We reply by email.',
    ja: 'お店についてお聞かせください。メールでお返事します。',
  },
  companyLocation: {
    en: 'Tokyo, Japan. Copyright © {year}. All rights reserved.',
    ja: '日本・東京。Copyright © {year}. All rights reserved.',
  },
  products: { en: 'Products', ja: '製品' },
  developers: { en: 'Developers', ja: '開発者向け' },
  socials: { en: 'Socials', ja: 'ソーシャル' },
  company: { en: 'Company', ja: '企業情報' },
  theSuite: {
    en: 'The suite',
    ja: 'スイート',
  },
  agentWorkflows: {
    en: 'Agent workflows',
    ja: 'エージェントのワークフロー',
  },
  approvalsReceipts: {
    en: 'Approvals and receipts',
    ja: '承認と記録',
  },
  integrations: {
    en: 'Integrations',
    ja: '連携',
  },
  custodyModel: { en: 'Custody Model', ja: 'カストディモデル' },
  passkeys: { en: 'Passkeys', ja: 'パスキー' },
  walletsSignatures: { en: 'Wallets & Signatures', ja: 'ウォレットと署名' },
  permissionsPolicy: { en: 'Permissions & Policy', ja: '権限とポリシー' },
  documentation: { en: 'Documentation', ja: 'ドキュメント' },
  architecture: { en: 'Architecture', ja: 'アーキテクチャ' },
  guides: { en: 'Guides', ja: 'ガイド' },
  about: { en: 'About', ja: '会社概要' },
  blog: { en: 'Blog', ja: 'ブログ' },
  siteFooter: { en: 'Site footer', ja: 'サイトフッター' },
  footerNavigation: { en: 'Footer navigation', ja: 'フッターナビゲーション' },
  seamsHome: { en: 'Seams home', ja: 'Seamsホーム' },
  primary: { en: 'Primary', ja: 'メインナビゲーション' },
  dashboard: { en: 'Dashboard', ja: 'ダッシュボード' },
  openMenu: { en: 'Open menu', ja: 'メニューを開く' },
  closeMenu: { en: 'Close menu', ja: 'メニューを閉じる' },
  satyrProduct: {
    en: 'Satyr Ecommerce Suite',
    ja: 'Satyr ECスイート',
  },
  satyrNav: {
    en: 'Agents run the online shop, the inbox and the café',
    ja: 'エージェントがオンラインショップ、受信箱、カフェを運営',
  },
  satyrDocs: {
    en: 'Connect your store and café, set limits, and run agents',
    ja: 'ストアとカフェの接続、上限の設定、エージェントの運用',
  },
  satyrTour: {
    en: 'See Satyr run a café',
    ja: 'Satyrがカフェを運営する様子を見る',
  },
  satyrTourCopy: {
    en: 'The shop, the inbox, approvals and the bake plan',
    ja: 'ショップ、受信箱、承認、生産計画',
  },
  bakeryNav: {
    en: 'Production runs for bakeries, inside Satyr',
    ja: 'Satyrの中で動くベーカリーの生産計画',
  },
  bakeryDocs: {
    en: 'Production runs for bakeries. Docs are coming soon.',
    ja: 'ベーカリーの生産計画。ドキュメントは準備中です。',
  },
  walletNav: {
    en: 'A standalone stablecoin wallet with passkeys and policy',
    ja: 'パスキーとポリシーを備えたスタンドアロンのステーブルコインウォレット',
  },
  getStartedCopy: {
    en: 'Install the SDK, create a wallet, and sign with policy',
    ja: 'SDKの導入、ウォレットの作成、ポリシーに従う署名',
  },
  architectureCopy: {
    en: 'How passkeys, policy, and signing fit together',
    ja: 'パスキー、ポリシー、署名の仕組み',
  },
  releases: { en: 'Releases', ja: 'リリース' },
  talkUs: { en: 'Talk to us', ja: 'ご相談はこちら' },
  language: { en: 'Language', ja: '言語' },
  close: { en: 'Close', ja: '閉じる' },
  contactTitle: {
    en: 'Tell us about your business',
    ja: 'ビジネスについてお聞かせください',
  },
  contactCopy: {
    en: 'The form opens your email app with the message ready to send. You can also write to',
    ja: '入力内容をまとめてメールアプリを開きます。次のアドレスにも直接ご連絡いただけます：',
  },
  contactForm: { en: 'Contact sales form', ja: '営業へのお問い合わせフォーム' },
  name: { en: 'Name', ja: '氏名' },
  workEmail: { en: 'Work email', ja: '仕事用メールアドレス' },
  projectDetails: { en: 'Project details', ja: 'プロジェクトの詳細' },
  projectPlaceholder: {
    en: 'What do you sell, and where can Satyr help?',
    ja: '販売している商品や、Satyrに相談したいことをお聞かせください。',
  },
  emailSales: { en: 'Email sales', ja: 'メールで営業に相談' },
  salesSubject: {
    en: 'Sales inquiry from {name} at {company}',
    ja: '{company}の{name}様からのお問い合わせ',
  },
} satisfies Record<string, Record<Locale, string>>;

export type MessageKey = keyof typeof messages;
export type Translate = (key: MessageKey) => string;

export function translate(locale: Locale, key: MessageKey): string {
  return messages[key][locale];
}
