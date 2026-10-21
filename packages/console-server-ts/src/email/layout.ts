/**
 * The one HTML layout for every Seams email: Console notices and Wallet Email OTP codes.
 *
 * Mail clients ignore stylesheets and most modern CSS, so the layout is tables with
 * inline styles. Colours, the wordmark, and the black pill button follow the site
 * (apps/seams-site/src/styles/h2.css). The wordmark is a PNG because Gmail does not
 * show SVG images; its alt text keeps the brand when images are blocked.
 */

const SITE_ORIGIN = 'https://seams.sh';
const WORDMARK_URL = `${SITE_ORIGIN}/brand/seams-wordmark-email.png`;
const COMPANY_NAME = 'Seams Technologies KK';

const COLOR = {
  canvas: '#f5f3f1',
  card: '#ffffff',
  border: '#ebe8e4',
  line: '#f2f0ed',
  ink: '#0a0a0a',
  graphite: '#44403b',
  smoke: '#777169',
} as const;

const FONT =
  "'Hanken Grotesk', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const MONO = "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Courier New', monospace";

export interface EmailLink {
  readonly label: string;
  readonly url: string;
}

export interface EmailFact {
  readonly label: string;
  readonly value: string;
}

export type EmailBlock =
  | { readonly kind: 'paragraph'; readonly text: string }
  | { readonly kind: 'note'; readonly text: string }
  | { readonly kind: 'code'; readonly label: string; readonly code: string }
  | { readonly kind: 'links'; readonly items: readonly EmailLink[] }
  | { readonly kind: 'facts'; readonly rows: readonly EmailFact[] };

export interface EmailLayoutInput {
  /** The inbox preview line; it is hidden in the message body. */
  readonly preheader: string;
  readonly heading: string;
  readonly blocks: readonly EmailBlock[];
  readonly action: EmailLink | null;
  /** A closing line under the button, such as a safety note. */
  readonly closing?: string;
}

export function renderEmailLayoutHtml(input: EmailLayoutInput): string {
  let body = '';
  for (const block of input.blocks) body += renderBlock(block);
  if (input.action) body += renderButton(input.action);
  if (input.closing) body += paragraph(input.closing, COLOR.smoke, '14px', '0');
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light">
    <meta name="supported-color-schemes" content="light">
    <title>${escapeHtml(input.heading)}</title>
    <link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600&amp;display=swap" rel="stylesheet">
  </head>
  <body style="margin:0;padding:0;background:${COLOR.canvas};color:${COLOR.ink};font-family:${FONT};-webkit-font-smoothing:antialiased;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${COLOR.canvas};">${escapeHtml(input.preheader)}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:${COLOR.canvas};">
      <tr>
        <td align="center" style="padding:40px 16px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;">
            <tr>
              <td style="padding:0 8px 20px;">
                <a href="${SITE_ORIGIN}" style="text-decoration:none;color:${COLOR.ink};"><img src="${WORDMARK_URL}" width="121" height="24" alt="seams" style="display:block;border:0;height:24px;width:121px;color:${COLOR.ink};font-family:${FONT};font-size:22px;font-weight:600;"></a>
              </td>
            </tr>
            <tr>
              <td style="background:${COLOR.card};border:1px solid ${COLOR.border};border-radius:22px;padding:36px 32px 32px;">
                <h1 style="margin:0 0 16px;color:${COLOR.ink};font-family:${FONT};font-size:24px;line-height:1.25;font-weight:500;letter-spacing:-0.01em;">${escapeHtml(input.heading)}</h1>
                ${body}
              </td>
            </tr>
            <tr>
              <td style="padding:20px 8px 0;color:${COLOR.smoke};font-family:${FONT};font-size:12px;line-height:1.6;">
                ${escapeHtml(COMPANY_NAME)} &middot; <a href="${SITE_ORIGIN}" style="color:${COLOR.smoke};text-decoration:underline;">seams.sh</a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function renderBlock(block: EmailBlock): string {
  switch (block.kind) {
    case 'paragraph':
      return paragraph(block.text, COLOR.graphite, '15px', '0 0 16px');
    case 'note':
      return paragraph(block.text, COLOR.smoke, '14px', '0 0 16px');
    case 'code':
      return `<div aria-label="${escapeHtml(block.label)}" style="margin:8px 0 24px;padding:20px 16px;border-radius:16px;background:${COLOR.ink};color:#ffffff;font-family:${MONO};font-size:32px;font-weight:600;letter-spacing:0.24em;text-align:center;">${escapeHtml(block.code)}</div>`;
    case 'links':
      return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 20px;border-top:1px solid ${COLOR.line};">${block.items
        .map(
          (item) =>
            `<tr><td style="padding:12px 0;border-bottom:1px solid ${COLOR.line};font-family:${FONT};font-size:15px;"><a href="${escapeHtml(item.url)}" style="color:${COLOR.ink};font-weight:500;text-decoration:none;">${escapeHtml(item.label)} &rarr;</a></td></tr>`,
        )
        .join('')}</table>`;
    case 'facts':
      return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:4px 0 20px;border-top:1px solid ${COLOR.line};">${block.rows
        .map(
          (row) =>
            `<tr><td style="padding:10px 12px 10px 0;border-bottom:1px solid ${COLOR.line};color:${COLOR.smoke};font-family:${FONT};font-size:14px;">${escapeHtml(row.label)}</td><td align="right" style="padding:10px 0;border-bottom:1px solid ${COLOR.line};color:${COLOR.ink};font-family:${FONT};font-size:14px;font-weight:500;">${escapeHtml(row.value)}</td></tr>`,
        )
        .join('')}</table>`;
    default:
      return assertNever(block);
  }
}

function renderButton(action: EmailLink): string {
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:8px 0 24px;"><tr><td style="border-radius:9999px;background:${COLOR.ink};"><a href="${escapeHtml(action.url)}" style="display:inline-block;padding:13px 24px;border-radius:9999px;background:${COLOR.ink};color:#ffffff;font-family:${FONT};font-size:15px;font-weight:600;line-height:1;text-decoration:none;">${escapeHtml(action.label)} &rarr;</a></td></tr></table>`;
}

function paragraph(text: string, color: string, size: string, margin: string): string {
  return `<p style="margin:${margin};color:${color};font-family:${FONT};font-size:${size};line-height:1.6;">${escapeHtml(text)}</p>`;
}

/** "October 28, 2026" */
export function formatEmailDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/** "October 28, 2026 at 09:00 UTC" */
export function formatEmailDateTime(iso: string): string {
  const date = new Date(iso);
  const time = date.toLocaleTimeString('en-GB', {
    timeZone: 'UTC',
    hour: '2-digit',
    minute: '2-digit',
  });
  return `${formatEmailDate(iso)} at ${time} UTC`;
}

/** "2026-10" becomes "October 2026" */
export function formatEmailMonth(monthUtc: string): string {
  return new Date(`${monthUtc}-01T00:00:00.000Z`).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'long',
  });
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function assertNever(value: never): never {
  throw new Error(`Unexpected email block: ${JSON.stringify(value)}`);
}
