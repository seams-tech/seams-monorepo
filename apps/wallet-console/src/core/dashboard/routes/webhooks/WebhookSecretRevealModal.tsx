import React from 'react';
import { t } from '@core/i18n';
import { CopyButton } from '@core/components/CopyButton';
import { DashboardInlineModal } from '../../components/DashboardInlineModal';

const REVEAL_SECRET_TITLE_ID = 'dashboard-webhook-secret-title';

export interface WebhookSecretReveal {
  endpointId: string;
  endpointUrl: string;
  signingSecret: string;
  secretVersion: number;
  reason: 'created' | 'rotated';
}

interface WebhookSecretRevealModalProps {
  reveal: WebhookSecretReveal | null;
  onRequestClose: () => void;
}

/* The plaintext is sealed the moment it is stored, so no read route can hand
   it back. This dialog is the customer's only chance to capture it, which is
   why closing is an explicit acknowledgement rather than an incidental
   dismissal elsewhere in the page. */
function WebhookSecretRevealBody(props: {
  reveal: WebhookSecretReveal;
  onRequestClose: () => void;
}): React.JSX.Element {
  const { reveal, onRequestClose } = props;
  const created = reveal.reason === 'created';

  return (
    <>
      <div className="dashboard-modal__header">
        <h2 id={REVEAL_SECRET_TITLE_ID}>
          {created ? t('webhooksEndpointAdded') : t('webhooksSecretRotated')}
        </h2>
      </div>

      <p className="dashboard-modal__lede">
        {t('webhooksCopySecretPre')}
        <code>{reveal.endpointUrl}</code>
        {t('webhooksCopySecretPost')}
      </p>

      <div className="dashboard-webhook-secret">
        <span className="dashboard-webhook-secret__label">
          {t('webhooksSigningSecret')} <span aria-hidden="true">·</span> v{reveal.secretVersion}
        </span>
        <div className="dashboard-webhook-secret__value">
          <code>{reveal.signingSecret}</code>
          <CopyButton text={reveal.signingSecret} ariaLabel={t('webhooksCopySecretAria')} />
        </div>
      </div>

      {!created ? (
        <p className="dashboard-form-alert" role="alert">
          {t('webhooksRotatedWarning')}
        </p>
      ) : null}

      <div className="dashboard-form-actions">
        <button
          type="button"
          className="dashboard-pagination-button dashboard-pagination-button--primary"
          onClick={onRequestClose}
        >
          {t('webhooksSavedIt')}
        </button>
      </div>
    </>
  );
}

export function WebhookSecretRevealModal(props: WebhookSecretRevealModalProps): React.JSX.Element {
  const { reveal, onRequestClose } = props;
  return (
    <DashboardInlineModal
      isOpen={Boolean(reveal)}
      ariaLabel={t('webhooksSecretAria')}
      ariaLabelledBy={REVEAL_SECRET_TITLE_ID}
      onRequestClose={onRequestClose}
    >
      {reveal ? <WebhookSecretRevealBody reveal={reveal} onRequestClose={onRequestClose} /> : null}
    </DashboardInlineModal>
  );
}

export default WebhookSecretRevealModal;
