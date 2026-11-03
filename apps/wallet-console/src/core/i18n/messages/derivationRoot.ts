import type { Entry } from '../entry';

export const derivationRootMessages = {
  derivationPhasePreparing: { en: 'Preparing rotation', ja: 'ローテーションを準備中' },
  derivationPhaseInstalling: { en: 'Installing new shares', ja: '新しいシェアをインストール中' },
  derivationPhaseVerifying: { en: 'Verifying root continuity', ja: 'ルートの連続性を検証中' },
  derivationPhaseActivating: { en: 'Activating new shares', ja: '新しいシェアを有効化中' },
  derivationPhaseRetiring: { en: 'Retiring previous shares', ja: '以前のシェアを廃止中' },
  derivationPhaseComplete: { en: 'Rotation complete', ja: 'ローテーション完了' },
  derivationActiveSharesLabel: { en: 'Active operational shares', ja: '有効な運用シェア' },
  derivationActiveSharesDetail: {
    en: 'Deriver A and Deriver B hold epoch {epoch} operational shares.',
    ja: 'Deriver A と Deriver B がエポック {epoch} の運用シェアを保持しています。',
  },
  derivationRotationInProgress: { en: 'Rotation in progress', ja: 'ローテーション実行中' },
  derivationRotationInProgressDetail: {
    en: 'Normal signing continues. New derivation ceremonies may pause briefly.',
    ja: '通常の署名は継続されます。新しい導出セレモニーは一時的に停止する場合があります。',
  },
  derivationRotationCompleteDetail: {
    en: 'Epoch {epoch} is active and both previous shares are proved retired.',
    ja: 'エポック {epoch} が有効です。以前の両方のシェアが廃止されたことが証明されています。',
  },
  derivationRetirementIncompleteLabel: {
    en: 'Rotation active; retirement incomplete',
    ja: 'ローテーションは有効ですが、廃止が未完了です',
  },
  derivationRetirementIncompleteDetail: {
    en: 'The new shares are active, but this deployment has not proved the previous shares were retired.',
    ja: '新しいシェアは有効ですが、このデプロイメントでは以前のシェアが廃止されたことを証明できていません。',
  },
  derivationRotationFailedLabel: {
    en: 'Rotation failed before activation',
    ja: '有効化前にローテーションが失敗しました',
  },
  derivationRotationFailedDetail: {
    en: 'The derivation root is unchanged ({code}). Its material was cleaned up.',
    ja: '導出ルートは変更されていません（{code}）。関連する素材はクリーンアップされました。',
  },
  derivationRotationCleanupLabel: {
    en: 'Rotation failed; cleanup incomplete',
    ja: 'ローテーションが失敗し、クリーンアップが未完了です',
  },
  derivationRotationCleanupDetail: {
    en: '{description} still requires removal ({code}).',
    ja: '{description} の削除がまだ必要です（{code}）。',
  },
  derivationRetiredClaimErased: {
    en: 'Retired shares are cryptographically destroyed, so a copy of the previous shares cannot be reused.',
    ja: '廃止されたシェアは暗号的に破棄されているため、以前のシェアのコピーを再利用することはできません。',
  },
  derivationRetiredClaimNotVerified: {
    en: 'Operational shares rotate, but this deployment has not verified cryptographic erasure of retired shares.',
    ja: '運用シェアはローテーションされますが、このデプロイメントでは廃止されたシェアの暗号的な消去は検証されていません。',
  },
  derivationNoBackupLabel: { en: 'No recovery backup', ja: 'リカバリーバックアップがありません' },
  derivationNoBackupDetail: {
    en: 'Choose a recovery governance policy and enrol both wrapper keys.',
    ja: 'リカバリーガバナンスポリシーを選択し、両方のラッパー鍵を登録してください。',
  },
  derivationWrapperIncompleteLabel: { en: 'Wrapper keys incomplete', ja: 'ラッパー鍵が未完了です' },
  derivationWrapperNeitherDetail: {
    en: 'Neither Deriver A nor Deriver B has proved control of a wrapper key.',
    ja: 'Deriver A も Deriver B も、ラッパー鍵を管理していることをまだ証明していません。',
  },
  derivationWrapperOneDetail: {
    en: 'One role has proved control. Both are required before a backup can be created.',
    ja: '片方のロールのみが管理を証明しました。バックアップを作成するには両方が必要です。',
  },
  derivationCreatingBackupLabel: {
    en: 'Creating recovery backup',
    ja: 'リカバリーバックアップを作成中',
  },
  derivationCreatingBackupDetail: {
    en: 'Deriver A and Deriver B are generating a dedicated sharing of the same root.',
    ja: 'Deriver A と Deriver B が、同じルートの専用の分割シェアを生成しています。',
  },
  derivationBackupReadyLabel: {
    en: 'Recovery backup ready',
    ja: 'リカバリーバックアップの準備完了',
  },
  derivationBackupReadyDetail: {
    en: 'Recovery set {id} is available to download.',
    ja: 'リカバリーセット {id} をダウンロードできます。',
  },
  derivationReplacingBackupLabel: {
    en: 'Replacing recovery backup',
    ja: 'リカバリーバックアップを置き換え中',
  },
  derivationReplacingBackupDetail: {
    en: 'Recovery set {id} stays downloadable until the replacement is verified.',
    ja: '置き換えが検証されるまで、リカバリーセット {id} はダウンロードできます。',
  },
  derivationBackupFailedLabel: {
    en: 'Recovery backup failed',
    ja: 'リカバリーバックアップに失敗しました',
  },
  derivationBackupFailedDetail: {
    en: 'No recovery backup exists ({code}). Its partial material was cleaned up.',
    ja: 'リカバリーバックアップは存在しません（{code}）。作成途中の素材はクリーンアップされました。',
  },
  derivationReplacementFailedLabel: {
    en: 'Replacement failed; previous backup still active',
    ja: '置き換えに失敗しました。以前のバックアップは引き続き有効です',
  },
  derivationReplacementFailedDetail: {
    en: 'Recovery set {id} remains downloadable ({code}).',
    ja: 'リカバリーセット {id} は引き続きダウンロードできます（{code}）。',
  },
  derivationBackupReadyCleanupLabel: {
    en: 'Backup ready — earlier cleanup pending',
    ja: 'バックアップの準備完了 — 以前のクリーンアップが保留中',
  },
  derivationBackupReadyCleanupDetail: {
    en: 'You can create a new backup. Provider deletion of earlier recovery material is still pending and will be checked again during backup creation.',
    ja: '新しいバックアップを作成できます。以前のリカバリー素材のプロバイダー側での削除はまだ保留中で、バックアップの作成時に再確認されます。',
  },
  derivationEarlierCleanupLabel: {
    en: 'Earlier backup cleanup pending',
    ja: '以前のバックアップのクリーンアップが保留中です',
  },
  derivationEarlierCleanupDetail: {
    en: 'You can retry backup creation. Cleanup of the earlier attempt remains tracked until the provider confirms deletion.',
    ja: 'バックアップの作成を再試行できます。以前の試行のクリーンアップは、プロバイダーが削除を確認するまで追跡されます。',
  },
  derivationTenantHeldLabel: {
    en: 'Recovery files are tenant-held',
    ja: 'リカバリーファイルはテナントが保持しています',
  },
  derivationTenantHeldDetail: {
    en: 'This deployment can verify that your recovery files restored this root, but it does not store them for redownload. Keep your files, or replace the recovery backup to create a new set here.',
    ja: 'このデプロイメントでは、リカバリーファイルでこのルートが復元されたことを検証できますが、再ダウンロード用にファイルを保存していません。ファイルを保管するか、リカバリーバックアップを置き換えてここに新しいセットを作成してください。',
  },
  derivationNeverDownloaded: { en: 'Never downloaded', ja: 'ダウンロードされていません' },
  derivationDownloadIssued: {
    en: 'Sent to a browser on {date}. This deployment cannot confirm it was saved.',
    ja: '{date} にブラウザーへ送信されました。このデプロイメントでは保存されたことを確認できません。',
  },
  derivationDownloadVerified: {
    en: 'Verified on disk by the CLI on {date} ({level}).',
    ja: '{date} にCLIがディスク上で検証しました（{level}）。',
  },
  derivationTrustOffline: {
    en: 'Signatures and certificates verify against pinned roots. Revocation status was not available.',
    ja: '署名と証明書は固定されたルートに対して検証されました。失効状況は確認できませんでした。',
  },
  derivationTrustSnapshot: {
    en: 'Checked against a saved trust snapshot issued {date}.',
    ja: '{date} に発行された保存済みの信頼スナップショットで確認しました。',
  },
  derivationTrustCurrent: {
    en: 'Checked against current revocation status at {date}.',
    ja: '{date} 時点の最新の失効状況で確認しました。',
  },
  derivationSourceRetiredLabel: { en: 'Source retirement verified', ja: 'ソースの廃止を検証済み' },
  derivationSourceRetiredDetail: {
    en: 'The source deployment has verified retirement evidence.',
    ja: 'ソースのデプロイメントには、廃止を検証済みの証拠があります。',
  },
  derivationSourceUnverifiedLabel: {
    en: 'Source retirement unverified',
    ja: 'ソースの廃止が未検証です',
  },
  derivationSourceUnverifiedDetail: {
    en: 'The source deployment is unavailable. Its retirement has not been verified.',
    ja: 'ソースのデプロイメントは利用できません。廃止は検証されていません。',
  },
  derivationSourceRetainedLabel: {
    en: 'Source retained as backup',
    ja: 'ソースをバックアップとして保持',
  },
  derivationSourceRetainedDetail: {
    en: 'The source deployment is retained as a backup and remains part of the custody boundary.',
    ja: 'ソースのデプロイメントはバックアップとして保持され、引き続きカストディの境界に含まれます。',
  },
  derivationNoRestoreLabel: { en: 'No restore in progress', ja: '進行中の復元はありません' },
  derivationNoRestoreDetail: {
    en: 'Restore uses this site’s console API. Recovery imports require an empty destination; an active derivation root cannot be overwritten.',
    ja: '復元にはこのサイトのコンソールAPIを使用します。リカバリーのインポートには空の復元先が必要です。有効な導出ルートを上書きすることはできません。',
  },
  derivationAwaitingManifestLabel: {
    en: 'Waiting for the recovery manifest',
    ja: 'リカバリーマニフェストを待機中',
  },
  derivationAwaitingManifestDetail: {
    en: 'Register the public manifest from your recovery files.',
    ja: 'リカバリーファイルの公開マニフェストを登録してください。',
  },
  derivationAwaitingRoleLabel: { en: 'Waiting for role shares', ja: 'ロールのシェアを待機中' },
  derivationAwaitingRoleNeither: {
    en: 'Run the Deriver A and Deriver B commands. They may run on different machines.',
    ja: 'Deriver A と Deriver B のコマンドを実行してください。別々のマシンで実行しても構いません。',
  },
  derivationAwaitingRoleOne: {
    en: 'One role share is installed. Run the remaining role command.',
    ja: 'ロールのシェアが1つインストールされています。残りのロールのコマンドを実行してください。',
  },
  derivationVerifyingContinuityLabel: { en: 'Verifying continuity', ja: '連続性を検証中' },
  derivationVerifyingContinuityDetail: {
    en: 'Both role shares are installed.',
    ja: '両方のロールのシェアがインストールされています。',
  },
  derivationReadyToActivate: { en: 'Ready to activate', ja: '有効化の準備完了' },
  derivationRefreshingSharesLabel: {
    en: 'Refreshing operational shares',
    ja: '運用シェアをリフレッシュ中',
  },
  derivationRefreshingSharesDetail: {
    en: 'The restored root is being forward-refreshed before activation.',
    ja: '有効化の前に、復元されたルートをフォワードリフレッシュしています。',
  },
  derivationRestoredRootActive: { en: 'Restored root active', ja: '復元されたルートが有効です' },
  derivationRestoreFailedLabel: {
    en: 'Restore failed before activation',
    ja: '有効化前に復元が失敗しました',
  },
  derivationRestoreFailedDetail: {
    en: 'No root was activated ({code}). Imported material was cleaned up.',
    ja: 'ルートは有効化されていません（{code}）。インポートされた素材はクリーンアップされました。',
  },
  derivationRestoreCleanupLabel: {
    en: 'Restore material requires cleanup',
    ja: '復元の素材のクリーンアップが必要です',
  },
  derivationStillRequiresRemoval: {
    en: '{description} still requires removal.',
    ja: '{description} の削除がまだ必要です。',
  },
  derivationActivationCleanup: { en: 'activation cleanup', ja: '有効化のクリーンアップ' },
  derivationActivatedCleanupLabel: {
    en: 'Activated root requires cleanup',
    ja: '有効化されたルートのクリーンアップが必要です',
  },
  derivationRestoreExpiredLabel: {
    en: 'Restore session expired',
    ja: '復元セッションの有効期限が切れました',
  },
  derivationRestoreExpiredDetail: {
    en: 'The session expired on {date}. Start a new one.',
    ja: '{date} にセッションの有効期限が切れました。新しいセッションを開始してください。',
  },
  derivationHolderRestoreLabel: {
    en: 'Holder {holder}: restore your share',
    ja: '保持者 {holder}：自分のシェアを復元',
  },
  derivationHolderRestoreNote: {
    en: 'Run inside your extracted recovery folder. Use your actual wrapper-key file path. Approve the matching code in your browser when prompted. The CLI registers the manifest and saves retry state automatically; rerun this command to retry.',
    ja: '展開したリカバリーフォルダー内で実行してください。実際のラッパー鍵ファイルのパスを指定してください。確認を求められたら、ブラウザーで対応するコードを承認してください。CLIはマニフェストを登録し、再試行用の状態を自動的に保存します。再試行するには、このコマンドをもう一度実行してください。',
  },
  derivationCheckImportsLabel: { en: 'Check both imports', ja: '両方のインポートを確認' },
  derivationCheckImportsNote: {
    en: 'Both holders must finish before activation. Retry any missing import with the same holder command.',
    ja: '有効化の前に、両方の保持者がインポートを完了する必要があります。未完了のインポートは、同じ保持者のコマンドで再試行してください。',
  },
  derivationActivateRecoveryLabel: { en: 'Activate recovery', ja: 'リカバリーを有効化' },
  derivationActivateRecoveryNote: {
    en: 'After both holders finish, check the status first. Run the activation command when both imports are ready. Keep restore-session.json for activation retries. If activation requests offline trust acknowledgement, read the explanation below before retrying.',
    ja: '両方の保持者が完了したら、まずステータスを確認してください。両方のインポートの準備ができたら、有効化コマンドを実行してください。有効化の再試行に備えて restore-session.json を保管してください。有効化でオフライン信頼の承認を求められた場合は、再試行する前に下の説明を読んでください。',
  },
  derivationResumeActivationLabel: { en: 'Resume activation', ja: '有効化を再開' },
  derivationActivateRestoredLabel: {
    en: 'Activate the restored root',
    ja: '復元されたルートを有効化',
  },
  derivationResumeActivationNote: {
    en: 'Reuse the session file from your first activation attempt. Bootstrap access is destroyed after activation. If you originally used --acknowledge-offline-trust, include it again.',
    ja: '最初の有効化で使用したセッションファイルを再利用してください。ブートストラップアクセスは有効化の後に破棄されます。最初に --acknowledge-offline-trust を使用した場合は、再度指定してください。',
  },
  derivationActivateRestoredNote: {
    en: 'Keep the private session file for retries. Activation verifies the root commitment, refreshes operational shares, and destroys imported material. Add --acknowledge-offline-trust only if current trust could not be confirmed and you accept offline verification.',
    ja: '再試行に備えて、非公開のセッションファイルを保管してください。有効化ではルートのコミットメントを検証し、運用シェアをリフレッシュし、インポートされた素材を破棄します。--acknowledge-offline-trust は、最新の信頼を確認できず、オフライン検証を受け入れる場合にのみ追加してください。',
  },
  derivationGovernanceNotChosen: {
    en: 'Recovery governance has not been chosen. Choose it before enrolling wrapper keys.',
    ja: 'リカバリーガバナンスが選択されていません。ラッパー鍵を登録する前に選択してください。',
  },
  derivationGovernanceSingle: {
    en: 'Single owner: one organization owner can change recovery custody alone. Warning acknowledged by {owner} on {date}.',
    ja: '単独オーナー：組織のオーナー1人だけでリカバリーのカストディを変更できます。{owner} が {date} に警告を確認しました。',
  },
  derivationGovernanceTwo: {
    en: "Two-person: recovery custody changes need a second owner's approval. Selected by {owner} on {date}.",
    ja: '2人承認：リカバリーのカストディを変更するには、2人目のオーナーの承認が必要です。{owner} が {date} に選択しました。',
  },
  derivationWrapperSetup: { en: '{role} wrapper key setup', ja: '{role} ラッパー鍵のセットアップ' },
  derivationWrapperSetupCompleted: {
    en: '{role} wrapper key setup (completed)',
    ja: '{role} ラッパー鍵のセットアップ（完了）',
  },
  derivationWrapperSetupNote: {
    en: 'Requires Node.js 22 or later. Run in a macOS or Linux terminal, then approve the matching code in the dashboard. The CLI creates the wrapper key file at ./{role}-wrapper.key. Keep this file for step 4.',
    ja: 'Node.js 22 以降が必要です。macOS または Linux のターミナルで実行し、ダッシュボードで対応するコードを承認してください。CLIは ./{role}-wrapper.key にラッパー鍵ファイルを作成します。このファイルはステップ4で使うため保管してください。',
  },
  derivationConflictPairNotCommitted: {
    en: 'Both wrapper keys must be enrolled and committed before a backup can be created. Commit the pair in step 2.',
    ja: 'バックアップを作成する前に、両方のラッパー鍵を登録してコミットする必要があります。ステップ2でペアをコミットしてください。',
  },
  derivationConflictGovernance: {
    en: 'Save an approval policy in step 1 before creating a backup.',
    ja: 'バックアップを作成する前に、ステップ1で承認ポリシーを保存してください。',
  },
  derivationConflictInFlight: {
    en: 'A backup is already being created. Refresh the status before starting another request.',
    ja: 'バックアップはすでに作成中です。別のリクエストを開始する前に、ステータスを更新してください。',
  },
  derivationConflictCleanup: {
    en: 'Backup creation failed and provider cleanup is still pending. You can retry after the backup cooldown.',
    ja: 'バックアップの作成に失敗し、プロバイダー側のクリーンアップが保留中です。バックアップのクールダウン後に再試行できます。',
  },
  derivationConflictVerification: {
    en: 'The generated backup did not pass all required checks. No new backup is ready. Ask your deployment operator to review the failed generation before retrying.',
    ja: '生成されたバックアップは、必要なすべての検証に合格しませんでした。新しいバックアップは準備できていません。再試行する前に、デプロイメントの運用担当者に失敗した生成の確認を依頼してください。',
  },
  derivationConflictDefault: {
    en: 'The server refused this backup request ({code}). Refresh the status and review the recovery details before retrying.',
    ja: 'サーバーがこのバックアップリクエストを拒否しました（{code}）。再試行する前に、ステータスを更新してリカバリーの詳細を確認してください。',
  },
  derivationVerificationLabel: { en: 'Verification:', ja: '検証方法：' },
  derivationPasskey: { en: 'Passkey', ja: 'パスキー' },
  derivationAuthenticatorApp: { en: 'Authenticator app', ja: '認証アプリ' },
  derivationChange: { en: 'Change', ja: '変更' },
  derivationVerifyIdentity: { en: 'Verify your identity', ja: '本人確認' },
  derivationVerificationMethod: { en: 'Verification method', ja: '検証方法' },
  derivationUseDeviceOrKey: {
    en: 'Use your device or security key.',
    ja: 'お使いのデバイスまたはセキュリティキーを使用します。',
  },
  derivationAuthenticatorSoon: {
    en: 'Authenticator app · Coming soon',
    ja: '認証アプリ · 近日対応予定',
  },
  derivationVerifySixDigit: {
    en: 'Verify with a six-digit code.',
    ja: '6桁のコードで検証します。',
  },
  derivationPasskeyHelp: {
    en: 'Your browser will prompt you to verify. If you need a passkey, it will guide you through setup first.',
    ja: 'ブラウザーが検証を求めます。パスキーが必要な場合は、先にセットアップを案内します。',
  },
  derivationAuthenticatorUnavailable: {
    en: 'Authenticator verification is not available yet. Select Passkey to continue.',
    ja: '認証アプリでの検証はまだ利用できません。続行するにはパスキーを選択してください。',
  },
  derivationCancel: { en: 'Cancel', ja: 'キャンセル' },
  derivationDone: { en: 'Done', ja: '完了' },
  derivationCreationUnconfirmed: {
    en: 'Creation could not be confirmed. Retry to resume.',
    ja: '作成を確認できませんでした。再試行して再開してください。',
  },
  derivationStatusLoadFailed: {
    en: 'The latest status could not be loaded.',
    ja: '最新のステータスを読み込めませんでした。',
  },
  derivationCreatingRoot: { en: 'Creating derivation root…', ja: '導出ルートを作成中…' },
  derivationRetryCreation: { en: 'Retry creation', ja: '作成を再試行' },
  derivationCreateRoot: { en: 'Create derivation root', ja: '導出ルートを作成' },
  derivationRefreshing: { en: 'Refreshing…', ja: '更新中…' },
  derivationRefresh: { en: 'Refresh', ja: '更新' },
  derivationCreatingRootFeedback: {
    en: 'Creating your derivation root. This may take a moment.',
    ja: '導出ルートを作成しています。しばらくかかる場合があります。',
  },
  derivationCheckingRootStatus: {
    en: 'Checking the latest root status…',
    ja: '最新のルートのステータスを確認中…',
  },
  derivationStatusRefreshedNoRoot: {
    en: 'Status refreshed. No derivation root is active yet.',
    ja: 'ステータスを更新しました。有効な導出ルートはまだありません。',
  },
  derivationSelectEnvironmentToCreate: {
    en: 'Select an environment to create its derivation root.',
    ja: '導出ルートを作成する環境を選択してください。',
  },
  derivationAskOwnerToCreate: {
    en: 'Ask an organization owner or an administrator with project management access to create this root.',
    ja: '組織のオーナー、またはプロジェクト管理権限を持つ管理者に、このルートの作成を依頼してください。',
  },
  derivationUnableToReadRequestFallback: {
    en: 'Unable to read request',
    ja: 'リクエストを読み取れません',
  },
  derivationApprovalFailedFallback: { en: 'Approval failed', ja: '承認に失敗しました' },
  derivationConfirmationCode: { en: 'Confirmation code', ja: '確認コード' },
  derivationOrganization: { en: 'Organization', ja: '組織' },
  derivationEnvironment: { en: 'Environment', ja: '環境' },
  derivationDeny: { en: 'Deny', ja: '拒否' },
  derivationUnableToReadThisRequest: {
    en: 'Unable to read this request. Check that the correct organization and environment are selected.',
    ja: 'このリクエストを読み取れません。正しい組織と環境が選択されていることを確認してください。',
  },
  derivationLoadingRequest: { en: 'Loading request…', ja: 'リクエストを読み込み中…' },
  derivationRequestDenied: { en: 'Request denied.', ja: 'リクエストは拒否されました。' },
  derivationVerifyAndApprove: { en: 'Verify and approve', ja: '検証して承認' },
  derivationVerifying: { en: 'Verifying…', ja: '検証中…' },
  derivationBackupParseRead: {
    en: 'Unable to read backup download request',
    ja: 'バックアップのダウンロードリクエストを読み取れません',
  },
  derivationBackupParseInvalid: {
    en: 'Invalid backup download request',
    ja: 'バックアップのダウンロードリクエストが無効です',
  },
  derivationBackupParseState: {
    en: 'Invalid backup download state',
    ja: 'バックアップのダウンロードの状態が無効です',
  },
  derivationBackupApprovalFailed: {
    en: 'Approval failed. Close this dialog and reopen the link from Terminal to try again.',
    ja: '承認に失敗しました。このダイアログを閉じ、ターミナルのリンクを開き直してもう一度お試しください。',
  },
  derivationApproveRecoveryDownload: {
    en: 'Approve recovery download',
    ja: 'リカバリーのダウンロードを承認',
  },
  derivationCloseRecoveryDownload: {
    en: 'Close recovery download',
    ja: 'リカバリーのダウンロードを閉じる',
  },
  derivationBackupCompare: {
    en: 'Compare this code with Terminal. Approve only if you requested this download.',
    ja: 'このコードをターミナルと照合してください。このダウンロードをリクエストした場合にのみ承認してください。',
  },
  derivationRecoverySet: { en: 'Recovery set', ja: 'リカバリーセット' },
  derivationBackupCliDownloads: {
    en: 'The CLI downloads this backup. Your private wrapper keys and ZIP password stay in Terminal.',
    ja: 'CLIがこのバックアップをダウンロードします。非公開のラッパー鍵とZIPパスワードはターミナルから出ません。',
  },
  derivationApproveDownload: { en: 'Approve download', ja: 'ダウンロードを承認' },
  derivationBackupApproved: {
    en: 'Approved. Return to Terminal to finish backup download.',
    ja: '承認しました。ターミナルに戻って、バックアップのダウンロードを完了してください。',
  },
  derivationBackupExpired: {
    en: 'Request expired. Run the recovery kit command again.',
    ja: 'リクエストの有効期限が切れました。リカバリーキットのコマンドをもう一度実行してください。',
  },
  derivationEnrollParseRead: {
    en: 'Unable to read enrollment request',
    ja: '登録リクエストを読み取れません',
  },
  derivationEnrollParseInvalid: {
    en: 'Invalid enrollment request',
    ja: '登録リクエストが無効です',
  },
  derivationEnrollParseState: { en: 'Invalid enrollment state', ja: '登録の状態が無効です' },
  derivationEnrollApprovalFailed: {
    en: 'Approval failed. Refresh the request and try again.',
    ja: '承認に失敗しました。リクエストを更新してもう一度お試しください。',
  },
  derivationApproveTerminalEnrollment: {
    en: 'Approve terminal enrollment',
    ja: 'ターミナルからの登録を承認',
  },
  derivationWrapperConnected: { en: 'Wrapper key connected', ja: 'ラッパー鍵を接続しました' },
  derivationWrapperEnrollment: { en: 'Wrapper key enrollment', ja: 'ラッパー鍵の登録' },
  derivationEnrollCompare: {
    en: 'Compare this code with Terminal. Approve only if you started this setup.',
    ja: 'このコードをターミナルと照合してください。このセットアップを開始した場合にのみ承認してください。',
  },
  derivationHolder: { en: 'Holder', ja: '保持者' },
  derivationKeyFingerprint: { en: 'Key fingerprint', ja: '鍵のフィンガープリント' },
  derivationPublicWrapperKey: { en: 'Public wrapper key', ja: '公開ラッパー鍵' },
  derivationEnrollPrivateStays: {
    en: 'Your private wrapper key stays on your computer. Approval registers this public key only.',
    ja: '非公開のラッパー鍵はお使いのコンピューターから出ません。承認によって登録されるのは、この公開鍵のみです。',
  },
  derivationApproveEnrollment: { en: 'Approve enrollment', ja: '登録を承認' },
  derivationRefreshRequest: { en: 'Refresh request', ja: 'リクエストを更新' },
  derivationEnrollApproved: {
    en: 'Approved. Return to Terminal to finish enrollment.',
    ja: '承認しました。ターミナルに戻って、登録を完了してください。',
  },
  derivationEnrollExpired: {
    en: 'Request expired. Run setup again using your saved key.',
    ja: 'リクエストの有効期限が切れました。保存したキーを使って、セットアップをもう一度実行してください。',
  },
  derivationWrapperEnrolled: { en: 'Wrapper key enrolled.', ja: 'ラッパー鍵を登録しました。' },
  derivationRestoreParseRead: {
    en: 'Unable to read restore approval',
    ja: '復元の承認を読み取れません',
  },
  derivationRestoreParseInvalid: { en: 'Invalid restore approval', ja: '復元の承認が無効です' },
  derivationRestoreParseState: {
    en: 'Invalid restore approval state',
    ja: '復元の承認の状態が無効です',
  },
  derivationRestoreSelectOrgEnv: {
    en: 'Select the organization and environment used in your terminal, then try again.',
    ja: 'ターミナルで使用している組織と環境を選択して、もう一度お試しください。',
  },
  derivationLoadingRestoreRequest: {
    en: 'Loading restore request…',
    ja: '復元リクエストを読み込み中…',
  },
  derivationRestoreCompleted: {
    en: 'Recovery completed successfully. The destination confirms your restored root is active.',
    ja: 'リカバリーが完了しました。復元されたルートが有効であることを復元先が確認しました。',
  },
  derivationRestoreApproved: {
    en: 'Restore access approved. Return to your terminal to continue.',
    ja: '復元アクセスを承認しました。ターミナルに戻って続行してください。',
  },
  derivationRestoreDenied: { en: 'Restore access denied.', ja: '復元アクセスは拒否されました。' },
  derivationRestoreExpired: {
    en: 'Request expired. Run the CLI command again.',
    ja: 'リクエストの有効期限が切れました。CLIコマンドをもう一度実行してください。',
  },
  derivationApproveRestoreAccess: { en: 'Approve restore access', ja: '復元アクセスを承認' },
  derivationCloseRestoreApproval: { en: 'Close restore approval', ja: '復元の承認を閉じる' },
  derivationRestoreCompare: {
    en: 'Compare this code with Terminal. Approve only if you started this restore.',
    ja: 'このコードをターミナルと照合してください。この復元を開始した場合にのみ承認してください。',
  },
  derivationRecoveryDestination: { en: 'Recovery destination', ja: 'リカバリーの復元先' },
  derivationRestoreGrantAccess: {
    en: 'Grant temporary restore access with your passkey. Your private wrapper keys stay on your device.',
    ja: 'パスキーで一時的な復元アクセスを許可します。非公開のラッパー鍵はお使いのデバイスから出ません。',
  },
  derivationApproveRestore: { en: 'Approve restore', ja: '復元を承認' },
  derivationTryAgain: { en: 'Try again', ja: 'もう一度試す' },
  derivationRestoreUnableToApprove: {
    en: 'Unable to approve restore access. Try again.',
    ja: '復元アクセスを承認できません。もう一度お試しください。',
  },
  derivationRestoreErrConnection: {
    en: 'The console could not connect securely to the recovery destination. Check that it is running and its HTTPS certificate is trusted, then try again. (restore_destination_connection_failed)',
    ja: 'コンソールがリカバリーの復元先に安全に接続できませんでした。復元先が稼働していて、HTTPS証明書が信頼されていることを確認してから、もう一度お試しください。（restore_destination_connection_failed）',
  },
  derivationRestoreErrIdentity: {
    en: 'The destination belongs to a different environment. Check the configured recovery destination.',
    ja: '復元先は別の環境に属しています。設定されているリカバリーの復元先を確認してください。',
  },
  derivationRestoreErrRedirect: {
    en: 'The recovery destination redirected the request. Configure its direct HTTPS address; restore credentials cannot be forwarded. (restore_destination_redirect_refused)',
    ja: 'リカバリーの復元先がリクエストをリダイレクトしました。直接のHTTPSアドレスを設定してください。復元の認証情報を転送することはできません。（restore_destination_redirect_refused）',
  },
  derivationRestoreErrCredential: {
    en: 'The destination rejected the console’s restore credential. Update the destination access configuration before retrying. (restore_destination_credential_rejected)',
    ja: '復元先がコンソールの復元用認証情報を拒否しました。再試行する前に、復元先のアクセス設定を更新してください。（restore_destination_credential_rejected）',
  },
  derivationRestoreErrInvalidResponse: {
    en: 'The destination returned an invalid restore session. Check that the destination runs the matching console version. (restore_destination_invalid_response)',
    ja: '復元先が無効な復元セッションを返しました。復元先が対応するバージョンのコンソールで動作していることを確認してください。（restore_destination_invalid_response）',
  },
  derivationRestoreErrUnavailable: {
    en: 'The recovery destination returned HTTP {status}. Check the destination service before retrying. (restore_destination_unavailable)',
    ja: 'リカバリーの復元先がHTTP {status} を返しました。再試行する前に、復元先のサービスを確認してください。（restore_destination_unavailable）',
  },
  derivationRestoreStepUp: {
    en: 'Verify your identity again to approve this restore.',
    ja: 'この復元を承認するには、もう一度本人確認を行ってください。',
  },
  derivationHealthy: { en: 'Healthy', ja: '正常' },
  derivationDegraded: { en: 'Degraded', ja: '低下' },
  derivationUnavailable: { en: 'Unavailable', ja: '利用不可' },
  derivationUnknown: { en: 'Unknown', ja: '不明' },
  derivationRecoveryAccessNotConfigured: {
    en: 'Recovery access has not been configured for this environment. Contact your deployment administrator to prepare a recovery destination. Your backup files are unchanged.',
    ja: 'この環境ではリカバリーアクセスが設定されていません。デプロイメントの管理者に連絡して、リカバリーの復元先を準備してください。バックアップファイルは変更されていません。',
  },
  derivationRecoveryDestinationInvalid: {
    en: 'The configured recovery destination is invalid. Contact your deployment administrator.',
    ja: '設定されているリカバリーの復元先が無効です。デプロイメントの管理者に連絡してください。',
  },
  derivationRecoveryAccessCheckFailed: {
    en: 'Unable to check recovery access. Refresh this page to retry.',
    ja: 'リカバリーアクセスを確認できません。このページを更新して再試行してください。',
  },
  derivationCopyLabel: { en: 'Copy {label}', ja: '{label}をコピー' },
  derivationLabelCopied: { en: '{label} copied', ja: '{label}をコピーしました' },
  derivationCouldNotCopyLabel: {
    en: 'Could not copy {label}. Try again.',
    ja: '{label}をコピーできませんでした。もう一度お試しください。',
  },
  derivationLabelEnvironment: { en: 'environment', ja: '環境' },
  derivationLabelOperationDigest: { en: 'operation digest', ja: '操作ダイジェスト' },
  derivationInstallCliLabel: {
    en: 'Install the Seams wallet CLI',
    ja: 'Seams wallet CLI をインストール',
  },
  derivationInstallCliNote: {
    en: 'Run once to install the CLI. Requires Node.js 22 or later.',
    ja: 'CLIをインストールするために1回だけ実行します。Node.js 22 以降が必要です。',
  },
  derivationCopyCommandLabel: { en: 'Copy {label} command', ja: '{label} のコマンドをコピー' },
  derivationCommandCopied: { en: 'Command copied', ja: 'コマンドをコピーしました' },
  derivationCouldNotCopyCommand: {
    en: 'Could not copy command. Try again.',
    ja: 'コマンドをコピーできませんでした。もう一度お試しください。',
  },
  derivationRotationCompleted: {
    en: 'Rotation completed. Activation receipt: {digest}',
    ja: 'ローテーションが完了しました。有効化レシート：{digest}',
  },
  derivationReadStateFailed: {
    en: 'Could not read derivation root state',
    ja: '導出ルートの状態を読み取れませんでした',
  },
  derivationStartRotationFailed: {
    en: 'Could not start rotation. Retry to resume.',
    ja: 'ローテーションを開始できませんでした。再試行して再開してください。',
  },
  derivationRecoveryBackup: { en: 'Recovery backup', ja: 'リカバリーバックアップ' },
  derivationRotateShares: { en: 'Rotate shares', ja: 'シェアのローテーション' },
  derivationRestoreDeployment: { en: 'Restore a deployment', ja: 'デプロイメントの復元' },
  derivationCheckingLatestStatus: {
    en: 'Checking the latest status…',
    ja: '最新のステータスを確認中…',
  },
  derivationStatusRefreshedLatest: {
    en: 'Status refreshed. You’re viewing the latest results.',
    ja: 'ステータスを更新しました。最新の結果を表示しています。',
  },
  derivationBackupProgressLabel: {
    en: 'Backup creation progress',
    ja: 'バックアップ作成の進行状況',
  },
  derivationCreatingYourBackup: {
    en: 'Creating your recovery backup…',
    ja: 'リカバリーバックアップを作成中…',
  },
  derivationCheckingYourBackup: { en: 'Checking your backup…', ja: 'バックアップを確認中…' },
  derivationStepCreateBackup: { en: 'Create backup', ja: 'バックアップを作成' },
  derivationStepRefreshStatus: { en: 'Refresh status', ja: 'ステータスを更新' },
  derivationStepReady: { en: 'Ready', ja: '準備完了' },
  derivationBackupStageRequest: {
    en: 'Creating your recovery backup. Complete any identity verification prompt. This can take 30 seconds or longer. Keep this page open.',
    ja: 'リカバリーバックアップを作成しています。本人確認のプロンプトが表示されたら完了してください。30秒以上かかる場合があります。このページを開いたままにしてください。',
  },
  derivationBackupStageRefresh: {
    en: 'Backup created. Checking the latest status before showing your downloads.',
    ja: 'バックアップを作成しました。ダウンロードを表示する前に、最新のステータスを確認しています。',
  },
  derivationBackupStageReady: {
    en: 'Your backup is ready. Download and verify the files in step 4.',
    ja: 'バックアップの準備ができました。ステップ4でファイルをダウンロードして検証してください。',
  },
  derivationBackupElapsed: {
    en: '{seconds}s elapsed · This page updates automatically.',
    ja: '{seconds}秒経過 · このページは自動的に更新されます。',
  },
  derivationWaitingToast: {
    en: 'Waiting for a second owner to approve operation {digest}. Retry the same action once they have.',
    ja: '2人目のオーナーが操作 {digest} を承認するのを待っています。承認後に、同じ操作をもう一度実行してください。',
  },
  derivationAlreadyRecorded: { en: '{message} (already recorded)', ja: '{message}（記録済み）' },
  derivationGovernanceRecorded: {
    en: 'Recovery governance recorded',
    ja: 'リカバリーガバナンスを記録しました',
  },
  derivationGovernanceRecordedFailed: {
    en: 'Recovery governance recorded failed',
    ja: 'リカバリーガバナンスを記録できませんでした',
  },
  derivationKeysCommitted: { en: 'Wrapper keys committed', ja: 'ラッパー鍵をコミットしました' },
  derivationKeysCommittedFailed: {
    en: 'Wrapper keys committed failed',
    ja: 'ラッパー鍵をコミットできませんでした',
  },
  derivationBackupCreated: {
    en: 'Recovery backup created',
    ja: 'リカバリーバックアップを作成しました',
  },
  derivationBackupCreatedFailed: {
    en: 'Recovery backup created failed',
    ja: 'リカバリーバックアップを作成できませんでした',
  },
  derivationEnvironmentStatus: { en: 'Environment status', ja: '環境のステータス' },
  derivationUnableToLoad: { en: 'Unable to load threshold keys', ja: 'しきい値鍵を読み込めません' },
  derivationPageIntroEmpty: {
    en: 'Manage the key infrastructure used for threshold signing and wallet recovery.',
    ja: 'しきい値署名とウォレットのリカバリーに使用する鍵インフラを管理します。',
  },
  derivationEnvironmentSetup: { en: 'Environment setup', ja: '環境のセットアップ' },
  derivationRootRequired: { en: 'Derivation root required', ja: '導出ルートが必要です' },
  derivationRootRequiredDescription: {
    en: 'Create a server-side derivation root for this environment to enable threshold signing and recovery setup.',
    ja: 'この環境のサーバー側の導出ルートを作成して、しきい値署名とリカバリーのセットアップを有効にします。',
  },
  derivationLoadingKeys: { en: 'Loading threshold keys', ja: 'しきい値鍵を読み込み中' },
  derivationCheckingShareStatus: {
    en: 'Checking the server-side share status…',
    ja: 'サーバー側のシェアのステータスを確認中…',
  },
  derivationPageIntro: {
    en: 'Manage the server-side root used to derive threshold signing shares. Rotate its shares and prepare a recovery backup.',
    ja: 'しきい値署名のシェアを導出するサーバー側のルートを管理します。シェアをローテーションし、リカバリーバックアップを準備します。',
  },
  derivationWorkflowsLabel: { en: 'Threshold Keys workflows', ja: 'しきい値鍵のワークフロー' },
  derivationTenantRecoveryLabel: {
    en: 'Tenant-controlled recovery',
    ja: 'テナントが管理するリカバリー',
  },
  derivationRecoveryIntro: {
    en: 'Prepare a backup so you can restore this root if a deployment is lost. Follow the four steps below.',
    ja: 'デプロイメントが失われた場合にこのルートを復元できるよう、バックアップを準備します。以下の4つのステップに従ってください。',
  },
  derivationStatusEnrolledCommit: {
    en: 'Wrapper keys enrolled · commit required',
    ja: 'ラッパー鍵を登録済み · コミットが必要です',
  },
  derivationStatusEnrolledCommitDetail: {
    en: 'Both holders have proved control of their keys. Commit the pair in step 2; no backup is ready yet.',
    ja: '両方の保持者が鍵の管理を証明しました。ステップ2でペアをコミットしてください。バックアップはまだ準備できていません。',
  },
  derivationStatusCommittedNoBackup: {
    en: 'Wrapper keys committed · backup not created',
    ja: 'ラッパー鍵をコミット済み · バックアップ未作成',
  },
  derivationStatusCommittedNoBackupDetail: {
    en: 'The enrolled pair is committed. Create a backup in step 3, then download and verify it in step 4.',
    ja: '登録済みのペアをコミットしました。ステップ3でバックアップを作成し、ステップ4でダウンロードして検証してください。',
  },
  derivationWarnNeverDownloaded: {
    en: 'Download all three files in step 4 and verify them in your terminal so you can use this backup.',
    ja: 'このバックアップを使用できるように、ステップ4で3つのファイルすべてをダウンロードし、ターミナルで検証してください。',
  },
  derivationStep1Title: { en: 'Choose who approves changes', ja: '変更を承認する人を選択' },
  derivationStep1Subtitle: {
    en: 'Set the approval policy for wrapper keys and backups.',
    ja: 'ラッパー鍵とバックアップの承認ポリシーを設定します。',
  },
  derivationSaved: { en: 'Saved', ja: '保存済み' },
  derivationStep1Choose: {
    en: 'Choose a policy, then save it to continue.',
    ja: 'ポリシーを選択し、保存して続行してください。',
  },
  derivationApprovalPolicySavedPeriod: {
    en: 'Approval policy saved.',
    ja: '承認ポリシーを保存しました。',
  },
  derivationWaitingPrefix: {
    en: 'Waiting for a second owner to approve operation',
    ja: '2人目のオーナーによる次の操作の承認を待っています：',
  },
  derivationWaitingGovernanceSuffix: {
    en: 'before {date}. Retry the saved choice after approval.',
    ja: '期限：{date}。承認後に、保存した選択を再試行してください。',
  },
  derivationWaitingBackupSuffix: {
    en: 'before {date}. Retry once they have.',
    ja: '期限：{date}。承認後に再試行してください。',
  },
  derivationApprovalPolicy: { en: 'Approval policy', ja: '承認ポリシー' },
  derivationTwoOwners: { en: 'Two owners', ja: '2人のオーナー' },
  derivationTwoOwnersDescription: {
    en: 'A second organization owner must approve recovery changes.',
    ja: 'リカバリーの変更には、2人目の組織オーナーの承認が必要です。',
  },
  derivationCheckingOwners: { en: 'Checking organization owners…', ja: '組織のオーナーを確認中…' },
  derivationCheckOwnersFailed: {
    en: 'Unable to check organization owners. Refocus this window to retry.',
    ja: '組織のオーナーを確認できません。このウィンドウをもう一度フォーカスして再試行してください。',
  },
  derivationRequiresTwoOwners: {
    en: 'Requires at least two active organization owners. Add another owner in Team members to enable this option.',
    ja: '有効な組織のオーナーが2人以上必要です。このオプションを有効にするには、チームメンバーで別のオーナーを追加してください。',
  },
  derivationOneOwner: { en: 'One owner', ja: '1人のオーナー' },
  derivationOneOwnerDescription: {
    en: 'One organization owner can change wrapper keys and backups.',
    ja: '組織のオーナー1人だけで、ラッパー鍵とバックアップを変更できます。',
  },
  derivationOneOwnerAcknowledge: {
    en: 'I understand that one owner alone can replace wrapper keys and backups.',
    ja: 'オーナー1人だけでラッパー鍵とバックアップを置き換えられることを理解しました。',
  },
  derivationVerifyAndSavePolicy: { en: 'Verify and save policy', ja: '検証してポリシーを保存' },
  derivationVerifyingAndSaving: { en: 'Verifying and saving…', ja: '検証して保存中…' },
  derivationCheckPolicyApproval: { en: 'Check policy approval', ja: 'ポリシーの承認を確認' },
  derivationApprovalPolicySaved: { en: 'Approval policy saved', ja: '承認ポリシーを保存済み' },
  derivationSaveApprovalPolicy: { en: 'Save approval policy', ja: '承認ポリシーを保存' },
  derivationStep2Title: { en: 'Enroll public wrapper keys', ja: '公開ラッパー鍵を登録' },
  derivationStep2Subtitle: {
    en: 'Generate wrapper keypairs to encrypt and decrypt the recovery packages.',
    ja: 'リカバリーパッケージの暗号化と復号に使用するラッパー鍵ペアを生成します。',
  },
  derivationCommitted: { en: 'Committed', ja: 'コミット済み' },
  derivationEnrolledNotCommitted: { en: 'Enrolled · not committed', ja: '登録済み · 未コミット' },
  derivationSetUp: { en: 'Set up', ja: 'セットアップ' },
  derivationStep2Body: {
    en: 'Generate wrapper keypairs to encrypt the server recovery material in step 3. The private wrapper keys stay on the holders’ devices and decrypt those packages during restoration.',
    ja: 'ステップ3で、サーバーのリカバリー素材を暗号化するラッパー鍵ペアを生成します。非公開のラッパー鍵は保持者のデバイスに残り、復元時にそれらのパッケージを復号します。',
  },
  derivationStep2NeedPolicy: {
    en: 'Save an approval policy to enroll public wrapper keys.',
    ja: '公開ラッパー鍵を登録するには、承認ポリシーを保存してください。',
  },
  derivationStep2DoneLabel: {
    en: 'Both public wrapper keys are registered and approved for this backup.',
    ja: '両方の公開ラッパー鍵がこのバックアップ用に登録され、承認されました。',
  },
  derivationStep2DoneDetail: {
    en: 'Create your backup in step 3, then save the recovery ZIP in step 4.',
    ja: 'ステップ3でバックアップを作成し、ステップ4でリカバリーZIPを保存してください。',
  },
  derivationStep2Folder: {
    en: 'Start in a new, empty folder on each holder’s device. Each command creates the named wrapper key file there. Keep that file for step 4.',
    ja: '各保持者のデバイスで、新しい空のフォルダーから始めてください。各コマンドは、そこに指定された名前のラッパー鍵ファイルを作成します。そのファイルはステップ4で使うため保管してください。',
  },
  derivationStep2Approve: {
    en: 'Approve the matching code in this dashboard. In step 4, the CLI includes these key files in your recovery ZIP and prompts for an optional ZIP password.',
    ja: 'このダッシュボードで対応するコードを承認してください。ステップ4では、CLIがこれらの鍵ファイルをリカバリーZIPに含め、任意のZIPパスワードの入力を求めます。',
  },
  derivationRestartStep2: { en: 'Restart from step 2', ja: 'ステップ2からやり直す' },
  derivationStep2ReadyToCommit: {
    en: 'Both public wrapper keys are enrolled: each holder has proved control of the matching private wrapper key. Commit this pair to authorize backup creation.',
    ja: '両方の公開ラッパー鍵が登録されました。各保持者が、対応する非公開のラッパー鍵を管理していることを証明しました。このペアをコミットして、バックアップの作成を許可してください。',
  },
  derivationCheckKeyPairApproval: { en: 'Check key-pair approval', ja: '鍵ペアの承認を確認' },
  derivationCommitWrapperKeys: { en: 'Commit wrapper keys', ja: 'ラッパー鍵をコミット' },
  derivationWaitingRecipients: {
    en: 'Waiting for a second owner to approve operation {digest}.',
    ja: '2人目のオーナーが操作 {digest} を承認するのを待っています。',
  },
  derivationRefreshEnrollmentStatus: {
    en: 'Refresh enrollment status',
    ja: '登録ステータスを更新',
  },
  derivationStep3Title: { en: 'Create your backup', ja: 'バックアップを作成' },
  derivationStep3Subtitle: {
    en: 'Encrypt a recovery package for each key holder.',
    ja: '鍵の保持者ごとにリカバリーパッケージを暗号化します。',
  },
  derivationCreating: { en: 'Creating', ja: '作成中' },
  derivationReplacementFailed: { en: 'Replacement failed', ja: '置き換えに失敗' },
  derivationPackagesGenerated: { en: 'Packages generated', ja: 'パッケージを生成済み' },
  derivationBlocked: { en: 'Blocked', ja: 'ブロック中' },
  derivationNotReady: { en: 'Not ready', ja: '未準備' },
  derivationStep3PairCommitted: {
    en: 'The wrapper key pair is committed. No backup is ready to download yet.',
    ja: 'ラッパー鍵ペアはコミットされています。ダウンロードできるバックアップはまだありません。',
  },
  derivationStep3NoAccess: {
    en: 'Your account does not have access to download a recovery package. Each designated holder must sign in to save their own kit.',
    ja: 'お使いのアカウントには、リカバリーパッケージをダウンロードする権限がありません。指定された各保持者が、サインインして自分のキットを保存する必要があります。',
  },
  derivationStep3Ready: {
    en: 'The encrypted backup is ready. Download and verify the files in step 4 to confirm they are saved safely.',
    ja: '暗号化されたバックアップの準備ができました。ステップ4でファイルをダウンロードして検証し、安全に保存されていることを確認してください。',
  },
  derivationStep3ReplacementFailed: {
    en: 'The replacement failed. Step 4 still contains your previous backup and its original wrapper keys are required to open it.',
    ja: '置き換えに失敗しました。ステップ4には以前のバックアップが残っており、開くには元のラッパー鍵が必要です。',
  },
  derivationStep3FinishEnrollments: {
    en: 'Finish both enrollments, then select Commit wrapper keys in step 2 before creating the new backup.',
    ja: '新しいバックアップを作成する前に、両方の登録を完了し、ステップ2で「ラッパー鍵をコミット」を選択してください。',
  },
  derivationCreatingBackup: { en: 'Creating backup…', ja: 'バックアップを作成中…' },
  derivationGenerateNewBackup: {
    en: 'Generate a new recovery backup',
    ja: '新しいリカバリーバックアップを生成',
  },
  derivationStep3CleanupPending: {
    en: 'Provider deletion of earlier recovery material is pending. You can create a new backup while cleanup continues to be tracked.',
    ja: '以前のリカバリー素材のプロバイダー側での削除は保留中です。クリーンアップの追跡が続いている間も、新しいバックアップを作成できます。',
  },
  derivationRefreshBackupStatus: {
    en: 'Refresh backup status',
    ja: 'バックアップのステータスを更新',
  },
  derivationStep4Title: { en: 'Save and verify the files', ja: 'ファイルを保存して検証' },
  derivationStep4SubtitleSplit: {
    en: 'Download your package and check it in your terminal.',
    ja: 'パッケージをダウンロードして、ターミナルで確認します。',
  },
  derivationStep4SubtitleBoth: {
    en: 'Download both packages and check them in your terminal.',
    ja: '両方のパッケージをダウンロードして、ターミナルで確認します。',
  },
  derivationStep4NeedBackup: {
    en: 'Generate a backup in step 3 to download the recovery ZIP.',
    ja: 'リカバリーZIPをダウンロードするには、ステップ3でバックアップを生成してください。',
  },
  derivationStep4KitSplit: {
    en: 'Each holder saves a recovery kit containing the manifest, their encrypted package, their private wrapper key, and instructions.',
    ja: '各保持者は、マニフェスト、自分の暗号化パッケージ、自分の非公開ラッパー鍵、および手順を含むリカバリーキットを保存します。',
  },
  derivationStep4KitBoth: {
    en: 'Save a recovery kit containing the manifest, both encrypted packages, both private wrapper keys, and instructions.',
    ja: 'マニフェスト、両方の暗号化パッケージ、両方の非公開ラッパー鍵、および手順を含むリカバリーキットを保存します。',
  },
  derivationStep4Run: {
    en: 'Run this command from the same Terminal folder you used for enrollment to create and save your recovery ZIP. Approve the matching code in your browser. The CLI downloads the encrypted recovery packages, verifies them with your local wrapper keys, and combines those files into a ZIP. Enter a ZIP password when prompted, or press Enter to skip encryption.',
    ja: '登録時に使用したものと同じターミナルのフォルダーでこのコマンドを実行し、リカバリーZIPを作成して保存します。ブラウザーで対応するコードを承認してください。CLIは暗号化されたリカバリーパッケージをダウンロードし、ローカルのラッパー鍵で検証して、それらのファイルをZIPにまとめます。プロンプトが表示されたらZIPパスワードを入力してください。暗号化しない場合は Enter を押します。',
  },
  derivationSaveKitLabel: { en: 'Save your recovery kit', ja: 'リカバリーキットを保存' },
  derivationSaveKitNoteBoth: {
    en: 'Your private wrapper keys and password stay in Terminal. The ZIP includes both wrapper keys, both encrypted recovery packages, the manifest and restore instructions.',
    ja: '非公開のラッパー鍵とパスワードはターミナルから出ません。ZIPには、両方のラッパー鍵、両方の暗号化されたリカバリーパッケージ、マニフェスト、復元の手順が含まれます。',
  },
  derivationSaveKitNoteOwn: {
    en: 'Your private wrapper key and password stay in Terminal. The ZIP includes your wrapper key, your encrypted recovery package, the manifest and restore instructions.',
    ja: '非公開のラッパー鍵とパスワードはターミナルから出ません。ZIPには、自分のラッパー鍵、自分の暗号化されたリカバリーパッケージ、マニフェスト、復元の手順が含まれます。',
  },
  derivationReplaceWarning: {
    en: 'Replacing this recovery backup cannot revoke copies you previously downloaded. Securely destroy old files and wrapper keys when you no longer need them.',
    ja: 'このリカバリーバックアップを置き換えても、以前にダウンロードしたコピーを無効にすることはできません。不要になった古いファイルとラッパー鍵は、安全に破棄してください。',
  },
  derivationOperationalShares: { en: 'Operational shares', ja: '運用シェア' },
  derivationShareVersion: { en: 'Share version {epoch}', ja: 'シェアバージョン {epoch}' },
  derivationTwoServices: {
    en: 'Two services each hold a share of this root.',
    ja: '2つのサービスがそれぞれ、このルートのシェアを保持しています。',
  },
  derivationLastRotation: { en: 'Last rotation', ja: '前回のローテーション' },
  derivationNotRotatedYet: { en: 'Not rotated yet', ja: 'まだローテーションされていません' },
  derivationNextScheduled: { en: 'Next scheduled', ja: '次回の予定' },
  derivationNoScheduler: {
    en: 'No scheduler is running; rotate manually',
    ja: 'スケジューラーが実行されていません。手動でローテーションしてください',
  },
  derivationRotationDescription: {
    en: 'Rotation refreshes both shares while keeping wallet keys, addresses, and client data the same. Each service continues to hold only its own share.',
    ja: 'ローテーションでは、ウォレットの鍵、アドレス、クライアントデータを変えずに、両方のシェアをリフレッシュします。各サービスは、引き続き自分のシェアのみを保持します。',
  },
  derivationReviewShareRotation: {
    en: 'Review share rotation',
    ja: 'シェアのローテーションを確認',
  },
  derivationPhaseDone: { en: ' — done', ja: ' — 完了' },
  derivationPreviousSharesErased: {
    en: 'Previous shares securely erased',
    ja: '以前のシェアを安全に消去しました',
  },
  derivationRecoveryCompleted: {
    en: 'Recovery completed successfully',
    ja: 'リカバリーが完了しました',
  },
  derivationRestoredRootActiveAt: {
    en: 'The restored root is active at {destination}.',
    ja: '復元されたルートは {destination} で有効です。',
  },
  derivationHowToRestore: { en: 'How to restore', ja: '復元の手順' },
  derivationNeedCliAndZip: {
    en: 'You need the Seams wallet CLI and your complete recovery ZIP.',
    ja: 'Seams wallet CLI と、完全なリカバリーZIPが必要です。',
  },
  derivationExtractZip: {
    en: 'Extract the ZIP and open Terminal in that folder. Keep all files together. If you encrypted the ZIP, enter its password when extracting it.',
    ja: 'ZIPを展開し、そのフォルダーでターミナルを開いてください。すべてのファイルを同じ場所にまとめておいてください。ZIPを暗号化した場合は、展開時にパスワードを入力してください。',
  },
  derivationApproveRecoveryAccess: {
    en: 'Approve recovery access',
    ja: 'リカバリーアクセスを承認',
  },
  derivationApproveAccessBody: {
    en: 'Each holder runs the commands below, then approves the matching Terminal code in this dashboard. Use the organization and environment shown above. Your wrapper keys stay on your device.',
    ja: '各保持者は以下のコマンドを実行し、このダッシュボードで対応するターミナルのコードを承認します。上に表示されている組織と環境を使用してください。ラッパー鍵はお使いのデバイスから出ません。',
  },
  derivationConnectTrustLabel: { en: 'Connect recovery trust', ja: 'リカバリーの信頼を接続' },
  derivationConnectTrustNote: {
    en: 'Run once on each holder’s device from the extracted folder to verify the backup’s authority and save it for offline checks.',
    ja: '各保持者のデバイスで、展開したフォルダーから1回だけ実行します。バックアップの権限を検証し、オフラインでの確認用に保存します。',
  },
  derivationDestination: { en: 'Destination', ja: '復元先' },
  derivationDestinationPlaceholder: {
    en: 'Waiting for a configured destination',
    ja: '設定済みの復元先を待機中',
  },
  derivationDestinationInvalid: {
    en: 'Enter an HTTPS destination URL without a path, query, or credentials.',
    ja: 'パス、クエリ、認証情報を含まない、HTTPSの復元先URLを入力してください。',
  },
  derivationDestinationHelp: {
    en: 'The commands below use this destination. It must be configured for recovery and have no active root.',
    ja: '以下のコマンドはこの復元先を使用します。リカバリー用に設定されていて、有効なルートがない必要があります。',
  },
  derivationCheckingRecoveryAccess: {
    en: 'Checking recovery access…',
    ja: 'リカバリーアクセスを確認中…',
  },
  derivationConsoleCanAuthorize: {
    en: 'This console can authorize restoration to {destination}. Use that destination, or ask your deployment administrator to update recovery access.',
    ja: 'このコンソールは {destination} への復元を承認できます。その復元先を使用するか、デプロイメントの管理者にリカバリーアクセスの更新を依頼してください。',
  },
  derivationOfflineSummary: {
    en: 'Activation asks for offline trust acknowledgement?',
    ja: '有効化でオフライン信頼の承認を求められた場合',
  },
  derivationOfflineBody: {
    en: 'Your backup passed cryptographic verification, but its current revocation status could not be checked. Continue only if you accept that this backup may have been revoked since it was created. Both imported shares are saved; you do not need to import them again.',
    ja: 'バックアップは暗号的な検証に合格しましたが、現在の失効状況を確認できませんでした。このバックアップが作成後に失効している可能性があることを受け入れる場合にのみ、続行してください。インポートした両方のシェアは保存されているため、もう一度インポートする必要はありません。',
  },
  derivationOfflineActivateLabel: {
    en: 'Activate with offline verification',
    ja: 'オフライン検証で有効化',
  },
  derivationOfflineActivateNote: {
    en: 'If you accept offline verification, run this command from the same folder. Keep the existing restore-session.json file for retries.',
    ja: 'オフライン検証を受け入れる場合は、同じフォルダーでこのコマンドを実行してください。再試行に備えて、既存の restore-session.json ファイルを保管してください。',
  },
  derivationRotateSharesQuestion: {
    en: 'Rotate operational shares?',
    ja: '運用シェアをローテーションしますか？',
  },
  derivationRotateSharesDescription: {
    en: 'Deriver A and Deriver B will replace their current shares while keeping the derivation root unchanged. Normal signing will continue. New derivation ceremonies may pause briefly. Verify your identity to authorize this rotation.',
    ja: 'Deriver A と Deriver B は、導出ルートを変更せずに、現在のシェアを置き換えます。通常の署名は継続されます。新しい導出セレモニーは一時的に停止する場合があります。このローテーションを承認するには、本人確認を行ってください。',
  },
  derivationVerifyingAndRotating: {
    en: 'Verifying and rotating…',
    ja: '検証してローテーション中…',
  },
  derivationRetryRotation: { en: 'Retry rotation', ja: 'ローテーションを再試行' },
  derivationRotateSharesButton: {
    en: 'Rotate operational shares',
    ja: '運用シェアをローテーション',
  },
} as const satisfies Record<string, Entry>;
