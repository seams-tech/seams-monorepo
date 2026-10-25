import type { Locale } from '@/marketing/i18n/locale';

// The features page's messages. Each message requires both languages.
export const messages = {
  featuresPageTitle: { en: 'Features | Seams Wallet', ja: '機能 | Seams Wallet' },
  featuresTitle: { en: 'Everything in Seams Wallet', ja: 'Seams Walletのすべての機能' },
  featuresDescription: {
    en: 'Passkeys, email recovery, device linking, regional infrastructure, and self-hosting.',
    ja: 'パスキー、メールでの復元、デバイスのリンク、リージョンごとの基盤、セルフホスト。',
  },
  sections: { en: 'On this page', ja: 'このページの内容' },

  recoveryKicker: { en: 'Safe, simple wallets', ja: '安全でシンプルなウォレット' },
  recoveryTitle: {
    en: 'No seed phrases. No lost wallets.',
    ja: 'シードフレーズは不要。ウォレットを失いません。',
  },
  recoveryCopy: {
    en: 'Users open their wallet with a passkey. If they lose a device, they recover with email and keep the same wallet and address.',
    ja: 'ユーザーはパスキーでウォレットを開きます。デバイスを紛失しても、メールで復元でき、ウォレットとアドレスはそのままです。',
  },
  passkeySignIn: { en: 'Passkey sign-in', ja: 'パスキーでサインイン' },
  passkeySignInCopy: {
    en: 'One passkey creates the account and its wallet. There is no seed phrase to write down or lose.',
    ja: '1つのパスキーでアカウントとウォレットを作成。書き留めたり失くしたりするシードフレーズはありません。',
  },
  emailRecovery: { en: 'Email recovery', ja: 'メールで復元' },
  emailRecoveryCopy: {
    en: 'A lost device is not a lost wallet. Users recover with an email code or a recovery code, then add a new passkey.',
    ja: 'デバイスを失くしても、ウォレットは失いません。メールコードか復元コードで復元し、新しいパスキーを追加します。',
  },
  deviceLinking: { en: 'Device linking', ja: 'デバイスのリンク' },
  deviceLinkingCopy: {
    en: 'Users scan a QR code to add a phone or laptop. Each device signs with its own passkey.',
    ja: 'QRコードを読み取ってスマートフォンやノートPCを追加。各デバイスは自身のパスキーで署名します。',
  },
  linkedDevicesFigure: { en: 'Linked devices', ja: 'リンク済みデバイス' },
  sameAddress: {
    en: 'The wallet address stays the same, so no funds have to move.',
    ja: 'ウォレットのアドレスは変わらないため、資産を移動する必要はありません。',
  },

  biometricsKicker: { en: 'Biometric authentication', ja: '生体認証' },
  biometricsTitle: {
    en: 'A face, a fingerprint, or a voice opens the wallet.',
    ja: '顔、指紋、声でウォレットを開く。',
  },
  biometricsCopy: {
    en: 'Biometric data stays on the user’s device. Seams receives only a signed proof that the user approved.',
    ja: '生体情報はユーザーのデバイスから出ません。Seamsが受け取るのは、ユーザーが承認したことを示す署名付きの証明だけです。',
  },
  available: { en: 'Available', ja: '提供中' },
  planned: { en: 'Planned', ja: '対応予定' },
  passkeys: { en: 'Passkeys', ja: 'パスキー' },
  passkeysCopy: {
    en: 'WebAuthn passkeys on every modern browser, synced by the platform or kept on a security key.',
    ja: '主要なブラウザで使えるWebAuthnパスキー。プラットフォームで同期するか、セキュリティキーに保存します。',
  },
  faceId: { en: 'Face ID and Touch ID', ja: 'Face IDとTouch ID' },
  faceIdCopy: {
    en: 'On Apple devices, the passkey prompt uses Face ID or Touch ID. Android fingerprint and Windows Hello work the same way.',
    ja: 'Appleのデバイスでは、パスキーの確認にFace IDまたはTouch IDを使います。Androidの指紋認証やWindows Helloも同じように使えます。',
  },
  voiceId: { en: 'VoiceID', ja: 'VoiceID' },
  voiceIdCopy: {
    en: 'Approve with your voice, hands-free. Voice templates and recognition stay on the user’s device.',
    ja: '手を使わずに、声で承認。声のテンプレートと認識処理はユーザーのデバイスから出ません。',
  },
  readDocs: { en: 'Read the docs', ja: 'ドキュメントを読む' },

  globalKicker: { en: 'Global deployments', ja: 'グローバル展開' },
  globeTitle: { en: 'Closer to your users.', ja: 'ユーザーの近くで。' },
  globeTitleMuted: { en: 'Across the globe.', ja: '世界のどこでも。' },
  globeDescription: {
    en: 'Regional wallet infrastructure brings signing closer to your users, reducing network travel for every interaction.',
    ja: 'リージョンごとのウォレット基盤で、ユーザーの近くで署名を処理。操作ごとの通信距離を短くします。',
  },
  globeEurope: { en: 'Europe', ja: 'ヨーロッパ' },
  globeApac: { en: 'APAC', ja: 'アジア太平洋' },
  globeUs: { en: 'US', ja: '米国' },
  globeAccessibleName: {
    en: 'Rotatable globe showing Europe, Asia Pacific, and US regions',
    ja: 'ヨーロッパ、アジア太平洋、米国のリージョンを表示する回転可能な地球儀',
  },

  selfHostedKicker: { en: 'Self-hosted', ja: 'セルフホスト' },
  selfHostedTitle: {
    en: 'Run Seams on your own cloud.',
    ja: '自社のクラウドでSeamsを運用。',
  },
  selfHostedCopy: {
    en: 'Keep the wallet servers in your own accounts. We help you set them up. Self-serve tooling is still coming.',
    ja: 'ウォレットのサーバーを自社のアカウントで運用できます。導入は当社がサポートします。セルフサービスのツールは準備中です。',
  },
  cloudflare: { en: 'Cloudflare Workers', ja: 'Cloudflare Workers' },
  cloudflareCopy: {
    en: 'Deploy the serverless wallet services to your own Cloudflare account.',
    ja: 'サーバーレスのウォレットサービスを、自社のCloudflareアカウントにデプロイ。',
  },
  virtualMachines: { en: 'Google Cloud and AWS', ja: 'Google CloudとAWS' },
  virtualMachinesCopy: {
    en: 'Our runtime build runs on Google Cloud and AWS virtual machines.',
    ja: '当社のランタイムビルドは、Google CloudとAWSの仮想マシンで動作します。',
  },
  openSource: { en: 'Open source, no lock-in', ja: 'オープンソースでロックインなし' },
  openSourceCopy: {
    en: 'Apache-2.0 source with key export. Your users can leave with their keys at any time.',
    ja: 'Apache-2.0で公開し、鍵のエクスポートにも対応。ユーザーはいつでも鍵を持って移行できます。',
  },
  noLockInFigure: { en: 'No lock-in', ja: 'ロックインなし' },
  contactUs: { en: 'Contact us', ja: 'お問い合わせ' },
  seePricing: { en: 'See pricing', ja: '料金を見る' },
  startFree: { en: 'Start free', ja: '無料で始める' },
  pricingBannerTitle: {
    en: 'Free to start. Pay per active user.',
    ja: '無料で開始。アクティブユーザー数に応じた料金。',
  },
  pricingBannerCopy: {
    en: 'The first 300 monthly active users are free, and development is always free. As you grow, you pay per active user, with signing included.',
    ja: '月間アクティブユーザー300人までは無料。開発環境はいつでも無料です。利用が増えたら、署名を含むアクティブユーザー数に応じた料金で使えます。',
  },
} satisfies Record<string, Record<Locale, string>>;

export type MessageKey = keyof typeof messages;

export function translate(locale: Locale, key: MessageKey): string {
  return messages[key][locale];
}
