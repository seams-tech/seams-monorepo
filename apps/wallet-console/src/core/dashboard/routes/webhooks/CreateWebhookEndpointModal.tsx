import React from 'react';
import { t } from '@core/i18n';
import type {
  ConsoleWebhookEventCategory,
  WebhookEventCategoryOption,
} from './webhookEventCatalog';
import {
  DashboardInlineModal,
  DashboardModalCloseButton,
} from '../../components/DashboardInlineModal';

const CREATE_WEBHOOK_TITLE_ID = 'dashboard-create-webhook-title';
const CREATE_WEBHOOK_EVENTS_LABEL_ID = 'dashboard-create-webhook-events';

function describeUrlProblem(value: string): string {
  const url = value.trim();
  if (!url) return t('webhooksUrlRequired');
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return t('webhooksUrlNeedsScheme');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return t('webhooksUrlProtocol');
  }
  return '';
}

/* The server accepts http:// so an endpoint can point at a tunnel or a
   staging host, so this is a warning rather than a rejection — but the dialog
   says plainly that plain HTTP ships event payloads in the clear. */
function isPlainHttpUrl(value: string): boolean {
  try {
    return new URL(value.trim()).protocol === 'http:';
  } catch {
    return false;
  }
}

interface CreateWebhookEndpointModalProps {
  isOpen: boolean;
  submitting: boolean;
  errorMessage: string;
  eventCategoryOptions: readonly WebhookEventCategoryOption[];
  onRequestClose: () => void;
  onSubmit(input: { url: string; eventCategories: ConsoleWebhookEventCategory[] }): void;
}

/* The draft lives one level below the dialog so a closed dialog holds no
   state at all: each opening mounts a blank form instead of clearing a
   half-filled one after it has already painted. */
function CreateWebhookEndpointForm(
  props: Omit<CreateWebhookEndpointModalProps, 'isOpen'>,
): React.JSX.Element {
  const { submitting, errorMessage, eventCategoryOptions, onRequestClose, onSubmit } = props;
  const [url, setUrl] = React.useState<string>('');
  const [eventCategories, setEventCategories] = React.useState<ConsoleWebhookEventCategory[]>([]);
  const [urlTouched, setUrlTouched] = React.useState<boolean>(false);

  const urlProblem = describeUrlProblem(url);
  const canSubmit = !submitting && !urlProblem && eventCategories.length > 0;

  const onToggleCategory = React.useCallback(
    (value: ConsoleWebhookEventCategory, checked: boolean) => {
      setEventCategories((current) =>
        checked
          ? current.includes(value)
            ? current
            : [...current, value]
          : current.filter((entry) => entry !== value),
      );
    },
    [],
  );

  return (
    <>
      <div className="dashboard-modal__header">
        <h2 id={CREATE_WEBHOOK_TITLE_ID}>{t('webhooksAddEndpoint')}</h2>
        <DashboardModalCloseButton
          ariaLabel={t('webhooksClose')}
          onClick={onRequestClose}
          disabled={submitting}
        />
      </div>

      <form
        className="dashboard-webhook-form"
        onSubmit={(event) => {
          event.preventDefault();
          setUrlTouched(true);
          if (!canSubmit) return;
          onSubmit({ url: url.trim(), eventCategories: [...eventCategories] });
        }}
      >
        <label className="dashboard-form-field">
          <span>{t('webhooksEndpointUrl')}</span>
          <input
            className="dashboard-input"
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            onBlur={() => setUrlTouched(true)}
            placeholder="https://api.example.com/webhooks/seams"
            disabled={submitting}
            aria-invalid={urlTouched && Boolean(urlProblem)}
          />
          {urlTouched && urlProblem ? (
            <p className="dashboard-form-hint dashboard-form-hint--error">{urlProblem}</p>
          ) : isPlainHttpUrl(url) ? (
            <p className="dashboard-form-hint">{t('webhooksPlainHttpWarning')}</p>
          ) : (
            <p className="dashboard-form-hint">{t('webhooksUrlHint')}</p>
          )}
        </label>

        {/* A real <fieldset>/<legend> pair sits outside the grid flow in every
            engine, so the legend loses the form's row gap; a labelled group
            keeps the semantics and the rhythm. */}
        <div
          className="dashboard-webhook-events"
          role="group"
          aria-labelledby={CREATE_WEBHOOK_EVENTS_LABEL_ID}
        >
          <span className="dashboard-webhook-events__legend" id={CREATE_WEBHOOK_EVENTS_LABEL_ID}>
            {t('webhooksSelectEvents')}
          </span>
          <div className="dashboard-webhook-events__list">
            {eventCategoryOptions.map((option) => {
              const checked = eventCategories.includes(option.value);
              return (
                <label
                  key={option.value}
                  className={[
                    'dashboard-webhook-event',
                    checked ? 'dashboard-webhook-event--checked' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  <input
                    type="checkbox"
                    className="dashboard-webhook-event__input"
                    checked={checked}
                    disabled={submitting}
                    onChange={(event) => onToggleCategory(option.value, event.target.checked)}
                  />
                  <span className="dashboard-webhook-event__copy">
                    <span className="dashboard-webhook-event__title">
                      {option.label}
                      <code>{option.value}.*</code>
                    </span>
                    <span className="dashboard-webhook-event__hint">{option.description}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </div>

        {errorMessage ? (
          <p className="dashboard-form-alert" role="alert">
            {errorMessage}
          </p>
        ) : null}

        <div className="dashboard-form-actions">
          <button
            type="button"
            className="dashboard-pagination-button dashboard-pagination-button--secondary"
            onClick={onRequestClose}
            disabled={submitting}
          >
            {t('webhooksCancel')}
          </button>
          <button
            type="submit"
            className="dashboard-pagination-button dashboard-pagination-button--primary"
            disabled={!canSubmit}
          >
            {submitting ? t('webhooksAddingProgress') : t('webhooksAddEndpoint')}
          </button>
        </div>
      </form>

      <p className="dashboard-modal__footnote">
        {t('webhooksFootnotePre')}
        <code>{'`${timestamp}.${rawBody}`'}</code>
        {t('webhooksFootnoteMid')}
        <code>X-Console-Webhook-Signature</code>
        {t('webhooksFootnotePost')}
      </p>
    </>
  );
}

export function CreateWebhookEndpointModal(
  props: CreateWebhookEndpointModalProps,
): React.JSX.Element {
  const { isOpen, ...formProps } = props;
  return (
    <DashboardInlineModal
      isOpen={isOpen}
      ariaLabel={t('webhooksAddEndpointAria')}
      ariaLabelledBy={CREATE_WEBHOOK_TITLE_ID}
      onRequestClose={formProps.onRequestClose}
    >
      <CreateWebhookEndpointForm {...formProps} />
    </DashboardInlineModal>
  );
}
