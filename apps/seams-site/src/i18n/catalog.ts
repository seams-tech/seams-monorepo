import type { Locale } from './locale';

export const messages = {
  companyName: { en: 'Company', ja: '会社名' },
  companyPageTitle: { en: 'Company | Seams', ja: '企業情報 | Seams' },
  companyTitle: {
    en: 'We build the account layer for commerce.',
    ja: 'コマースを支えるアカウント基盤をつくる。',
  },
  companyDescription: {
    en: 'Seams makes passkey wallets for users and scoped credentials for AI agents. Policy checks every action before it runs.',
    ja: 'Seamsは、ユーザー向けのパスキーウォレットと、AIエージェント向けの権限を限定した認証情報を提供します。すべての操作を実行前にポリシーで確認します。',
  },
  freePrice: { en: '$0', ja: '￥0' },
  contactSales: { en: 'Contact sales', ja: '営業に相談' },
  embeddedWallet: { en: 'Embedded Wallet', ja: '組み込みウォレット' },
  embeddedCopy: {
    en: 'Non-custodial wallets that open with a passkey. Keys are split between the user’s device and your infrastructure, so neither side can sign alone.',
    ja: 'パスキーで開くノンカストディアルウォレットです。鍵をユーザーの端末とお客様のインフラに分散し、署名には両方が必要です。',
  },
  exploreWallet: { en: 'Explore Embedded Wallet', ja: '組み込みウォレットを見る' },
  ecommerceAgents: { en: 'Ecommerce Agents', ja: 'ECエージェント' },
  agentsCopy: {
    en: 'Scoped credentials for AI agents and staff, with limits, approvals, and an audit trail on every action.',
    ja: 'AIエージェントとスタッフに、権限を限定した認証情報を提供します。すべての操作に上限、承認、監査履歴を適用します。',
  },
  exploreAgents: { en: 'Explore Ecommerce Agents', ja: 'ECエージェントを見る' },
  policyAudit: { en: 'Policy and audit', ja: 'ポリシーと監査' },
  policyCopy: {
    en: 'Approvals, budgets, and revocation run before anything is signed. Each decision is logged with who acted and why.',
    ja: '署名前に承認、予算、失効を確認します。各判断には、誰が操作したかと、その理由を記録します。',
  },
  readPolicy: { en: 'Read about policy', ja: 'ポリシーを読む' },
  usersKeys: { en: 'Users keep their keys', ja: '鍵の管理権はユーザーに' },
  usersKeysCopy: {
    en: 'No single party can sign alone. Exporting a key needs fresh approval from its owner.',
    ja: '署名には双方の協力が必要です。鍵のエクスポートには、所有者による新たな承認が必要です。',
  },
  policyFirst: { en: 'Policy runs first', ja: '実行前にポリシーを確認' },
  policyFirstCopy: {
    en: 'Limits, approvals, and session checks run before any credential can act.',
    ja: '認証情報を使う前に、上限、承認、セッションを確認します。',
  },
  oneSdk: { en: 'One small SDK', ja: 'ひとつの小さなSDK' },
  oneSdkCopy: {
    en: 'Sign-in, wallets, and delegated access come from one SDK, so teams do not rebuild key infrastructure.',
    ja: 'ログイン、ウォレット、委任アクセスをひとつのSDKで提供します。チームが鍵の基盤をつくり直す必要はありません。',
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
    en: 'Tell us what you are building. We reply by email.',
    ja: '開発中のサービスについてお聞かせください。メールでお返事します。',
  },
  companyLocation: {
    en: 'Tokyo, Japan. Copyright © {year}. All rights reserved.',
    ja: '日本・東京。Copyright © {year}. All rights reserved.',
  },
  products: { en: 'Products', ja: '製品' },
  platform: { en: 'Platform', ja: 'プラットフォーム' },
  developers: { en: 'Developers', ja: '開発者向け' },
  resources: { en: 'Resources', ja: 'リソース' },
  socials: { en: 'Socials', ja: 'ソーシャル' },
  company: { en: 'Company', ja: '企業情報' },
  custodyModel: { en: 'Custody Model', ja: 'カストディモデル' },
  walletSessions: { en: 'Wallet Sessions', ja: 'ウォレットセッション' },
  authentication: { en: 'Authentication', ja: '認証' },
  passkeys: { en: 'Passkeys', ja: 'パスキー' },
  walletsSignatures: { en: 'Wallets & Signatures', ja: 'ウォレットと署名' },
  permissionsPolicy: { en: 'Permissions & Policy', ja: '権限とポリシー' },
  documentation: { en: 'Documentation', ja: 'ドキュメント' },
  architecture: { en: 'Architecture', ja: 'アーキテクチャ' },
  walletIframe: { en: 'Wallet Iframe', ja: 'ウォレットiframe' },
  guides: { en: 'Guides', ja: 'ガイド' },
  useCases: { en: 'Use Cases', ja: 'ユースケース' },
  pricing: { en: 'Pricing', ja: '料金' },
  about: { en: 'About', ja: '会社概要' },
  blog: { en: 'Blog', ja: 'ブログ' },
  siteFooter: { en: 'Site footer', ja: 'サイトフッター' },
  footerNavigation: { en: 'Footer navigation', ja: 'フッターナビゲーション' },
  seamsHome: { en: 'Seams home', ja: 'Seamsホーム' },
  primary: { en: 'Primary', ja: 'メインナビゲーション' },
  dashboard: { en: 'Dashboard', ja: 'ダッシュボード' },
  openMenu: { en: 'Open menu', ja: 'メニューを開く' },
  closeMenu: { en: 'Close menu', ja: 'メニューを閉じる' },
  agentsNav: {
    en: 'AI agents with scoped credentials, acting inside policy',
    ja: '権限を限定した認証情報でポリシーに従って動くAIエージェント',
  },
  satyrProduct: { en: 'Satyr Ecommerce Automation', ja: 'Satyr EC自動化' },
  satyrNav: {
    en: 'Ecommerce agents and café management in one platform',
    ja: 'ECエージェントとカフェ管理をひとつのプラットフォームで',
  },
  satyrDocs: {
    en: 'Connect your store and café, set limits, and run agents',
    ja: 'ストアとカフェの接続、上限の設定、エージェントの運用',
  },
  satyrPricing: {
    en: 'Plans for stores and cafés run by agents',
    ja: 'エージェントが運営するストアとカフェ向けプラン',
  },
  bakeryNav: {
    en: 'Robotics for bakeries',
    ja: 'ベーカリーのためのロボティクス',
  },
  bakeryDocs: {
    en: 'Robotics for bakeries. Docs are coming soon.',
    ja: 'ベーカリーのためのロボティクス。ドキュメントは準備中です。',
  },
  bakeryPricing: {
    en: 'Robotics for bakeries. Pricing is coming soon.',
    ja: 'ベーカリーのためのロボティクス。料金は準備中です。',
  },
  walletNav: {
    en: 'A standalone stablecoin wallet with passkeys and policy',
    ja: 'パスキーとポリシーを備えたスタンドアロンのステーブルコインウォレット',
  },
  walletPricing: {
    en: 'Free, Growth, Pro, and Enterprise plans',
    ja: 'Free、Growth、Pro、Enterpriseプラン',
  },
  liveDemo: { en: 'Live demo', ja: 'ライブデモ' },
  liveDemoCopy: {
    en: 'Create a passkey wallet on the Embedded Wallet page',
    ja: '組み込みウォレットのページでパスキーウォレットを作成',
  },
  planPricing: { en: 'Plan pricing', ja: 'プランと料金' },
  getStartedCopy: {
    en: 'Install the SDK, create a wallet, and sign with policy',
    ja: 'SDKの導入、ウォレットの作成、ポリシーに従う署名',
  },
  architectureCopy: {
    en: 'How passkeys, policy, and signing fit together',
    ja: 'パスキー、ポリシー、署名の仕組み',
  },
  releases: { en: 'Releases', ja: 'リリース' },
  plans: { en: 'Plans', ja: 'プラン' },
  // Wallet Enterprise rates, as on the Wallet site's pricing page.
  enterpriseNav: {
    en: 'From $0.003 per user on committed volume',
    ja: '確約した利用量に応じて1人あたり約￥0.47から',
  },
  estimatePrice: { en: 'Estimate your price', ja: '料金を試算' },
  comparePlans: { en: 'Compare plans', ja: 'プランを比較' },
  talkUs: { en: 'Talk to us', ja: 'ご相談はこちら' },
  talkCopy: {
    en: 'Plan pricing and deployment options with the Seams team',
    ja: '料金プランと導入方法をSeamsチームに相談',
  },
  language: { en: 'Language', ja: '言語' },
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
export type Translate = (key: MessageKey) => string;

export function translate(locale: Locale, key: MessageKey): string {
  return messages[key][locale];
}
