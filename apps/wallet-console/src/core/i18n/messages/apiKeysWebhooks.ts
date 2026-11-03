import type { Entry } from '../entry';

/* Keys that end in Pre / Mid / Post split one sentence around an inline <code> element,
   so each language can place the code where its word order needs it. */
export const apiKeysWebhooksMessages = {
  // ── API keys: payment policy ──
  apiKeysPaymentDisabledLabel: {
    en: 'Stop when quota is exhausted',
    ja: 'クォータを使い切ったら停止',
  },
  apiKeysPaymentDisabledDescription: {
    en: 'Reject new managed registrations after the included quota is used up.',
    ja: '含まれているクォータを使い切った後は、新しいマネージド登録を拒否します。',
  },
  apiKeysPaymentQuotaThenLabel: {
    en: 'Use paid overage after quota',
    ja: 'クォータ超過後は従量課金を使用',
  },
  apiKeysPaymentQuotaThenDescription: {
    en: 'Use included quota first, then require x402 payment for extra registrations.',
    ja: '含まれているクォータを先に使用し、超過分の登録にはx402による支払いを必須にします。',
  },
  apiKeysPaymentAlwaysLabel: { en: 'Always require x402', ja: '常にx402を必須にする' },
  apiKeysPaymentAlwaysDescription: {
    en: 'Require x402 payment for every managed registration request.',
    ja: 'すべてのマネージド登録リクエストでx402による支払いを必須にします。',
  },
  apiKeysPaymentChipDisabled: { en: 'Quota only', ja: 'クォータのみ' },
  apiKeysPaymentChipQuotaThen: { en: 'Paid overage', ja: '超過は有料' },
  apiKeysPaymentChipAlways: { en: 'x402 required', ja: 'x402必須' },
  apiKeysOverageBehavior: { en: 'Overage behavior', ja: '超過時の動作' },

  // ── API keys: scope summary ──
  apiKeysMainnet: { en: 'Mainnet', ja: 'メインネット' },
  apiKeysTestnet: { en: 'Testnet', ja: 'テストネット' },
  apiKeysScopeAria: { en: 'Credential scope', ja: '認証情報のスコープ' },
  apiKeysScopeCreatingFor: { en: 'Creating for', ja: '作成先' },
  apiKeysScopeCurrent: { en: 'Current credential scope', ja: '現在の認証情報のスコープ' },
  apiKeysEnvironment: { en: 'Environment', ja: '環境' },
  apiKeysChainNetwork: { en: 'Chain network', ja: 'チェーンネットワーク' },
  apiKeysEnvironmentId: { en: 'Environment ID', ja: '環境ID' },

  // ── API keys: validation and status messages ──
  apiKeysUnsupportedScope: {
    en: 'Unsupported API credential scope: {scope}',
    ja: 'サポートされていないAPI認証情報のスコープです: {scope}',
  },
  apiKeysExpiryInvalid: {
    en: 'Credential expiry must be a valid timestamp.',
    ja: '認証情報の有効期限は有効なタイムスタンプで指定してください。',
  },
  apiKeysSessionUnavailable: {
    en: 'Console session is unavailable',
    ja: 'コンソールのセッションを利用できません',
  },
  apiKeysNameRequired: { en: 'Name is required.', ja: '名前は必須です。' },
  apiKeysSelectEnvironment: {
    en: 'Select an environment from the top bar before creating a credential.',
    ja: '認証情報を作成する前に、トップバーで環境を選択してください。',
  },
  apiKeysOriginRequired: {
    en: 'Add at least one allowed origin.',
    ja: '許可するオリジンを少なくとも1つ追加してください。',
  },
  apiKeysOriginMustIncludeRegistration: {
    en: 'Allowed origins must include the registration origin {origin}.',
    ja: '許可するオリジンには、登録元のオリジン {origin} を含める必要があります。',
  },
  apiKeysScopeRequired: {
    en: 'At least one scope is required.',
    ja: 'スコープを少なくとも1つ指定してください。',
  },
  apiKeysNotFound: { en: 'Credential was not found.', ja: '認証情報が見つかりませんでした。' },
  apiKeysOnlyRevokedDeletable: {
    en: 'Only revoked credentials can be deleted.',
    ja: '削除できるのは失効済みの認証情報のみです。',
  },
  apiKeysDeleteConfirm: {
    en: 'Delete revoked {kind} {id}? This permanently removes it from this environment.',
    ja: '失効済みの{kind} {id} を削除しますか？この環境から完全に削除されます。',
  },

  // ── API keys: credential kinds ──
  apiKeysModeBrowserTitle: { en: 'Browser publishable_key', ja: 'ブラウザー用 publishable_key' },
  apiKeysModeBrowserSummary: {
    en: 'Browser-safe key for managed bootstrap flows. Direct relay calls with publishable_key are rejected.',
    ja: 'マネージドブートストラップのフローで、ブラウザーから安全に使えるキーです。publishable_key を使ったリレーへの直接呼び出しは拒否されます。',
  },
  apiKeysModeServerTitle: { en: 'Server secret_key', ja: 'サーバー用 secret_key' },
  apiKeysModeServerSummary: {
    en: 'Server-only key for backend relay bootstrap calls. Keep it off the frontend and send it only from your backend.',
    ja: 'バックエンドからのリレーのブートストラップ呼び出し専用のキーです。フロントエンドには置かず、バックエンドからのみ送信してください。',
  },
  apiKeysNotApplicableSecret: {
    en: 'Not applicable for secret_key',
    ja: 'secret_key には適用されません',
  },
  apiKeysNoAllowedOrigins: { en: 'No allowed origins', ja: '許可するオリジンなし' },
  apiKeysOriginCount: { en: '{count} origins', ja: '{count}個のオリジン' },
  apiKeysKindPublishableLabel: { en: 'Publishable Key', ja: '公開可能キー' },
  apiKeysKindSecretLabel: { en: 'Secret Key', ja: 'シークレットキー' },
  apiKeysKindPublishableChip: { en: 'Publishable', ja: '公開可能' },
  apiKeysKindSecretChip: { en: 'Secret', ja: 'シークレット' },
  apiKeysRotate: { en: 'Rotate', ja: 'ローテーション' },
  apiKeysRevoke: { en: 'Revoke', ja: '失効' },
  apiKeysRotating: { en: 'Rotate...', ja: 'ローテーション中…' },
  apiKeysRevoking: { en: 'Revoke...', ja: '失効中…' },

  // ── API keys: page ──
  apiKeysPageAria: { en: 'Credential management page', ja: '認証情報の管理ページ' },
  apiKeysCreateCredential: { en: 'Create credential', ja: '認証情報を作成' },
  apiKeysItemSingular: { en: 'credential', ja: '認証情報' },
  apiKeysItemPlural: { en: 'credentials', ja: '認証情報' },

  // Secret banner
  apiKeysShownOnce: { en: 'Shown once', ja: '表示は1回のみ' },
  apiKeysSaveThisPublishable: {
    en: 'Save this publishable key now',
    ja: 'この公開可能キーを今すぐ保存してください',
  },
  apiKeysSaveThisSecret: {
    en: 'Save this secret key now',
    ja: 'このシークレットキーを今すぐ保存してください',
  },
  apiKeysActionCreated: { en: 'created', ja: '作成' },
  apiKeysActionRotated: { en: 'rotated', ja: 'ローテーション' },
  apiKeysReturnedOnlyWhen: {
    en: 'This value is only returned when the credential is {action}.',
    ja: 'この値は、認証情報の{action}時にのみ返されます。',
  },
  apiKeysIdExplainerPost: {
    en: ' is the credential ID used for management and audit trails, not the key value your app should send.',
    ja: ' は管理と監査証跡に使う認証情報IDです。アプリが送信するキーの値ではありません。',
  },
  apiKeysCredentialId: { en: 'Credential ID', ja: '認証情報ID' },
  apiKeysCredentialValue: { en: 'Credential value', ja: '認証情報の値' },
  apiKeysCopyValueAria: { en: 'Copy {kind} value', ja: '{kind}の値をコピー' },
  apiKeysCopied: {
    en: '{kind} copied to clipboard.',
    ja: '{kind}をクリップボードにコピーしました。',
  },
  apiKeysCopyFailed: {
    en: 'Clipboard copy failed. Copy manually.',
    ja: 'クリップボードへのコピーに失敗しました。手動でコピーしてください。',
  },
  apiKeysCopyValue: { en: 'Copy value', ja: '値をコピー' },
  apiKeysStoreSecurely: {
    en: 'Store it in your password manager or secrets vault before leaving this page.',
    ja: 'このページを離れる前に、パスワードマネージャーまたはシークレット保管庫に保存してください。',
  },

  // Integration snippet
  apiKeysSnippetAria: { en: 'Credential integration snippet', ja: '認証情報の連携スニペット' },
  apiKeysSnippetBrowserTitle: {
    en: 'Browser registration snippet',
    ja: 'ブラウザー登録スニペット',
  },
  apiKeysSnippetServerTitle: {
    en: 'Server bootstrap snippet',
    ja: 'サーバーブートストラップスニペット',
  },
  apiKeysSnippetBrowserDescription: {
    en: 'Use this publishable_key in browser-safe SDK config. Registration setup validates its environment and allowed-origin binding directly.',
    ja: 'この publishable_key は、ブラウザーで安全に使えるSDK設定で使用します。登録のセットアップでは、環境と許可オリジンの紐付けが直接検証されます。',
  },
  apiKeysSnippetServerDescription: {
    en: 'Use this secret_key from your backend only. Do not store it in frontend config or browser bundles.',
    ja: 'この secret_key はバックエンドからのみ使用してください。フロントエンドの設定やブラウザーのバンドルには保存しないでください。',
  },

  // Table
  apiKeysTableAria: { en: 'Credentials table', ja: '認証情報テーブル' },
  apiKeysColName: { en: 'Name', ja: '名前' },
  apiKeysColStatus: { en: 'Status', ja: 'ステータス' },
  apiKeysColAccess: { en: 'Access', ja: 'アクセス' },
  apiKeysColLastUsed: { en: 'Last used', ja: '最終使用' },
  apiKeysColActions: { en: 'Actions', ja: '操作' },
  apiKeysLoading: { en: 'Loading credentials', ja: '認証情報を読み込み中' },
  apiKeysUnauthorized: { en: 'unauthorized', ja: '認証されていません' },
  apiKeysUnavailableSession: {
    en: 'Credentials unavailable: {reason}.',
    ja: '認証情報を利用できません: {reason}。',
  },
  apiKeysUnavailableError: {
    en: 'Credentials unavailable: {reason}',
    ja: '認証情報を利用できません: {reason}',
  },
  apiKeysEmpty: {
    en: 'No credentials found for current scope.',
    ja: '現在のスコープに認証情報はありません。',
  },
  apiKeysEdit: { en: 'Edit', ja: '編集' },
  apiKeysMoreActionsFor: { en: 'More actions for {name}', ja: '{name} のその他の操作' },
  apiKeysDelete: { en: 'Delete', ja: '削除' },

  // Create modal
  apiKeysCreateModalAria: { en: 'Create credential modal', ja: '認証情報の作成モーダル' },
  apiKeysKindAria: { en: 'Credential kind', ja: '認証情報の種類' },
  apiKeysName: { en: 'Name', ja: '名前' },
  apiKeysAllowedOrigins: { en: 'Allowed origins', ja: '許可するオリジン' },
  apiKeysAddOriginExact: {
    en: 'Add the exact browser origin that calls the registration API.',
    ja: '登録APIを呼び出すブラウザーのオリジンを、正確に追加してください。',
  },
  apiKeysBrowserRunningAtPre: {
    en: 'This browser is running at ',
    ja: 'このブラウザーは',
  },
  apiKeysBrowserRunningAtPost: {
    en: ', so it is included by default.',
    ja: 'で実行されているため、既定で含まれています。',
  },
  apiKeysAddUri: { en: 'Add URI', ja: 'URIを追加' },
  apiKeysScopes: { en: 'Scopes', ja: 'スコープ' },
  apiKeysSourceIps: {
    en: 'Whitelisted source IPs (optional)',
    ja: '許可する送信元IP（任意）',
  },
  apiKeysSourceIpsHelpPre: {
    en: 'Only requests from these source IPs can use this ',
    ja: 'この',
  },
  apiKeysSourceIpsHelpPost: {
    en: '. Use IP addresses or CIDR ranges, not domains.',
    ja: 'を使用できるのは、これらの送信元IPからのリクエストのみです。ドメインではなく、IPアドレスまたはCIDR範囲を指定してください。',
  },
  apiKeysCancel: { en: 'Cancel', ja: 'キャンセル' },
  apiKeysCreatingProgress: { en: 'Creating...', ja: '作成中…' },
  apiKeysCreateKind: { en: 'Create {kind}', ja: '{kind}を作成' },

  // Edit modal
  apiKeysEditModalAria: { en: 'Edit credential modal', ja: '認証情報の編集モーダル' },
  apiKeysEditCredential: { en: 'Edit credential', ja: '認証情報を編集' },
  apiKeysExpiresAt: { en: 'Expires at (optional)', ja: '有効期限（任意）' },
  apiKeysOriginsStoredPre: {
    en: 'These origins are stored on this specific ',
    ja: 'これらのオリジンは、この',
  },
  apiKeysOriginsStoredPost: { en: '.', ja: 'に保存されます。' },
  apiKeysExactOriginsOnly: {
    en: 'Use exact browser origins only.',
    ja: 'ブラウザーのオリジンを正確に指定してください。',
  },
  apiKeysSavingProgress: { en: 'Saving...', ja: '保存中…' },
  apiKeysSaveChanges: { en: 'Save changes', ja: '変更を保存' },

  // Confirmation modal
  apiKeysConfirmModalAria: {
    en: 'Credential action confirmation modal',
    ja: '認証情報の操作の確認モーダル',
  },
  apiKeysConfirmTitle: { en: 'Are you sure?', ja: 'よろしいですか？' },
  apiKeysConfirmRotate: {
    en: 'Rotating this credential will replace the current key value immediately. Update any systems using it after the new key is shown.',
    ja: 'この認証情報をローテーションすると、現在のキーの値は直ちに置き換えられます。新しいキーが表示されたら、これを使用しているシステムを更新してください。',
  },
  apiKeysConfirmRevoke: {
    en: 'Revoking this credential blocks any further use immediately. This cannot be undone.',
    ja: 'この認証情報を失効させると、以後の使用は直ちにブロックされます。この操作は元に戻せません。',
  },
  apiKeysCredential: { en: 'Credential', ja: '認証情報' },

  // ── Webhooks: shared ──
  webhooksSessionUnavailable: {
    en: 'Console session is unavailable',
    ja: 'コンソールのセッションを利用できません',
  },

  // ── Webhooks: page ──
  webhooksPageAria: { en: 'Webhooks page', ja: 'Webhookページ' },
  webhooksAddEndpoint: { en: 'Add endpoint', ja: 'エンドポイントを追加' },
  webhooksItemEndpointSingular: { en: 'endpoint', ja: 'エンドポイント' },
  webhooksItemEndpointPlural: { en: 'endpoints', ja: 'エンドポイント' },
  webhooksItemDeliverySingular: { en: 'delivery', ja: '配信' },
  webhooksItemDeliveryPlural: { en: 'deliveries', ja: '配信' },
  webhooksStatusAria: { en: 'Webhook service status', ja: 'Webhookサービスのステータス' },
  webhooksEndpointsUnavailable: {
    en: 'Webhook endpoints unavailable: {reason}',
    ja: 'Webhookエンドポイントを利用できません: {reason}',
  },
  webhooksEndpointsTableAria: {
    en: 'Webhook endpoints table',
    ja: 'Webhookエンドポイントテーブル',
  },
  webhooksColEndpoint: { en: 'Endpoint', ja: 'エンドポイント' },
  webhooksColStatus: { en: 'Status', ja: 'ステータス' },
  webhooksColUpdated: { en: 'Updated', ja: '更新日時' },
  webhooksColActions: { en: 'Actions', ja: '操作' },
  webhooksLoadingEndpoints: {
    en: 'Loading webhook endpoints',
    ja: 'Webhookエンドポイントを読み込み中',
  },
  webhooksUnauthorized: { en: 'unauthorized', ja: '認証されていません' },
  webhooksUnavailableSession: {
    en: 'Webhooks unavailable: {reason}.',
    ja: 'Webhookを利用できません: {reason}。',
  },
  webhooksEmpty: {
    en: 'No webhook endpoints configured yet.',
    ja: 'Webhookエンドポイントはまだ設定されていません。',
  },
  webhooksSending: { en: 'Sending...', ja: '送信中…' },
  webhooksSendTestEvent: { en: 'Send test event', ja: 'テストイベントを送信' },
  webhooksDisable: { en: 'Disable', ja: '無効にする' },
  webhooksEnable: { en: 'Enable', ja: '有効にする' },
  webhooksMoreActionsFor: { en: 'More actions for {url}', ja: '{url} のその他の操作' },
  webhooksRotateSecret: { en: 'Rotate signing secret', ja: '署名シークレットをローテーション' },
  webhooksDelete: { en: 'Delete', ja: '削除' },
  webhooksRotateConfirm: {
    en: 'Rotate the signing secret for {url}? Deliveries are signed with the new secret immediately.',
    ja: '{url} の署名シークレットをローテーションしますか？配信は直ちに新しいシークレットで署名されます。',
  },
  webhooksDeleteConfirm: {
    en: 'Delete webhook endpoint {id}?',
    ja: 'Webhookエンドポイント {id} を削除しますか？',
  },

  // Test event toasts
  webhooksTestDelivered: { en: 'Test event delivered.', ja: 'テストイベントを配信しました。' },
  webhooksTestFailed: {
    en: 'Test delivery failed. Check the response in Deliveries.',
    ja: 'テスト配信に失敗しました。配信一覧でレスポンスを確認してください。',
  },
  webhooksTestCouldNotSend: {
    en: 'Could not send the test event.',
    ja: 'テストイベントを送信できませんでした。',
  },

  // Deliveries
  webhooksDeliveriesAria: { en: 'Webhook deliveries', ja: 'Webhookの配信' },
  webhooksDeliveries: { en: 'Deliveries', ja: '配信' },
  webhooksEndpointPre: { en: 'Endpoint ', ja: 'エンドポイント ' },
  webhooksSigningSecretSummary: {
    en: 'Signing secret v{version} {preview}',
    ja: '署名シークレット v{version} {preview}',
  },
  webhooksDeliveriesTableAria: {
    en: 'Webhook deliveries table',
    ja: 'Webhook配信テーブル',
  },
  webhooksColEvent: { en: 'Event', ja: 'イベント' },
  webhooksColAttempts: { en: 'Attempts', ja: '試行回数' },
  webhooksColResponse: { en: 'Response', ja: 'レスポンス' },
  webhooksColLastAttempt: { en: 'Last attempt', ja: '最終試行' },
  webhooksColAction: { en: 'Action', ja: '操作' },
  webhooksLoadingDeliveries: {
    en: 'Loading deliveries for {id}...',
    ja: '{id} の配信を読み込み中…',
  },
  webhooksDeliveriesUnavailable: {
    en: 'Deliveries unavailable: {reason}',
    ja: '配信を利用できません: {reason}',
  },
  webhooksDeliveriesEmpty: {
    en: 'No deliveries recorded for this endpoint yet.',
    ja: 'このエンドポイントの配信記録はまだありません。',
  },
  webhooksOpenedFromAudit: { en: 'Opened from audit', ja: '監査ログから開きました' },
  webhooksReplayCountOne: { en: '{count} replay', ja: '{count}回の再送信' },
  webhooksReplayCountMany: { en: '{count} replays', ja: '{count}回の再送信' },
  webhooksReplay: { en: 'Replay', ja: '再送信' },
  webhooksReplaying: { en: 'Replaying...', ja: '再送信中…' },

  // ── Webhooks: create endpoint modal ──
  webhooksUrlRequired: { en: 'Endpoint URL is required.', ja: 'エンドポイントURLは必須です。' },
  webhooksUrlNeedsScheme: {
    en: 'Enter an absolute URL, including the scheme.',
    ja: 'スキームを含む絶対URLを入力してください。',
  },
  webhooksUrlProtocol: {
    en: 'Endpoint URL must use https:// or http://.',
    ja: 'エンドポイントURLには https:// または http:// を使用してください。',
  },
  webhooksAddEndpointAria: { en: 'Add webhook endpoint', ja: 'Webhookエンドポイントを追加' },
  webhooksClose: { en: 'Close', ja: '閉じる' },
  webhooksEndpointUrl: { en: 'Endpoint URL', ja: 'エンドポイントURL' },
  webhooksPlainHttpWarning: {
    en: 'Plain http:// sends event payloads unencrypted. Use https:// outside local testing.',
    ja: 'http:// ではイベントのペイロードが暗号化されずに送信されます。ローカルでのテスト以外では https:// を使用してください。',
  },
  webhooksUrlHint: {
    en: 'Seams POSTs a JSON event envelope to this URL and records every attempt.',
    ja: 'SeamsはこのURLにJSONのイベントエンベロープをPOSTし、すべての試行を記録します。',
  },
  webhooksSelectEvents: { en: 'Select events to listen to', ja: '受信するイベントを選択' },
  webhooksCancel: { en: 'Cancel', ja: 'キャンセル' },
  webhooksAddingProgress: { en: 'Adding...', ja: '追加中…' },
  webhooksFootnotePre: {
    en: 'Every payload is signed with HMAC-SHA256 over ',
    ja: 'すべてのペイロードは、',
  },
  webhooksFootnoteMid: {
    en: ' using this endpoint’s signing secret. Verify the ',
    ja: ' に対して、このエンドポイントの署名シークレットを使ったHMAC-SHA256で署名されます。配信を信頼する前に、',
  },
  webhooksFootnotePost: {
    en: ' header before you trust a delivery.',
    ja: ' ヘッダーを検証してください。',
  },

  // ── Webhooks: secret reveal modal ──
  webhooksSecretAria: { en: 'Webhook signing secret', ja: 'Webhookの署名シークレット' },
  webhooksEndpointAdded: { en: 'Endpoint added', ja: 'エンドポイントを追加しました' },
  webhooksSecretRotated: {
    en: 'Signing secret rotated',
    ja: '署名シークレットをローテーションしました',
  },
  webhooksCopySecretPre: { en: 'Copy the signing secret for ', ja: 'エンドポイント ' },
  webhooksCopySecretPost: {
    en: ' now. Seams stores it encrypted and cannot show it again — if you lose it, rotate to mint a replacement.',
    ja: ' の署名シークレットを今すぐコピーしてください。Seamsは暗号化して保存しており、再表示できません。紛失した場合は、ローテーションして新しいシークレットを発行してください。',
  },
  webhooksSigningSecret: { en: 'Signing secret', ja: '署名シークレット' },
  webhooksCopySecretAria: {
    en: 'Copy webhook signing secret',
    ja: 'Webhookの署名シークレットをコピー',
  },
  webhooksRotatedWarning: {
    en: 'Deliveries are signed with the new secret from now on. Update your handler before the next event, or its signature check will fail.',
    ja: '今後の配信は新しいシークレットで署名されます。次のイベントの前にハンドラーを更新してください。更新しないと、署名の検証に失敗します。',
  },
  webhooksSavedIt: { en: 'I’ve saved it', ja: '保存しました' },

  // ── Webhooks: get started ──
  webhooksStartAria: { en: 'Get started with webhooks', ja: 'Webhookを始める' },
  webhooksStartTitle: {
    en: 'Send Seams events to your backend',
    ja: 'Seamsのイベントをバックエンドに送信',
  },
  webhooksStartLede: {
    en: 'Receive event notifications on your server. Track deliveries and replay failures here.',
    ja: 'サーバーでイベント通知を受信できます。ここで配信を追跡し、失敗した配信を再送信できます。',
  },
  webhooksReadDocs: { en: 'Read the docs', ja: 'ドキュメントを読む' },
  webhooksStep1Title: { en: 'Add an endpoint', ja: 'エンドポイントを追加' },
  webhooksStep1Body: {
    en: 'Enter your server URL and choose which events to receive.',
    ja: 'サーバーのURLを入力し、受信するイベントを選択します。',
  },
  webhooksStep2Title: { en: 'Verify each request', ja: '各リクエストを検証' },
  webhooksStep2Body: {
    en: 'Use your endpoint’s signing secret to check that each event came from Seams.',
    ja: 'エンドポイントの署名シークレットを使って、各イベントがSeamsから送られたことを確認します。',
  },
  webhooksSignatureDetails: { en: 'Signature details', ja: '署名の詳細' },
  webhooksSigReadPre: { en: 'Read ', ja: 'リクエストヘッダーの' },
  webhooksSigReadAnd: { en: ' and ', ja: ' と ' },
  webhooksSigReadMid: {
    en: ' from the request headers. Calculate HMAC-SHA256 using the timestamp, raw request body, and your endpoint’s ',
    ja: ' を読み取ります。タイムスタンプ、生のリクエストボディ、エンドポイントの ',
  },
  webhooksSigReadPost: {
    en: ' secret.',
    ja: ' シークレットを使ってHMAC-SHA256を計算します。',
  },
  webhooksSignatureVerificationAria: {
    en: 'Signature verification JavaScript',
    ja: '署名検証のJavaScript',
  },
  webhooksCopySnippetAria: {
    en: 'Copy signature verification snippet',
    ja: '署名検証のスニペットをコピー',
  },
  webhooksStep3Title: {
    en: 'Respond with 2xx within 10 seconds',
    ja: '10秒以内に2xxで応答',
  },
  webhooksStep3Body: {
    en: 'If a delivery fails, fix the issue and replay it from the deliveries table.',
    ja: '配信に失敗した場合は、問題を修正して、配信テーブルから再送信してください。',
  },
} as const satisfies Record<string, Entry>;
