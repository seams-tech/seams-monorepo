/**
 * The one HTML layout for every Seams email: Console notices and Wallet Email OTP codes.
 *
 * Mail clients ignore stylesheets and most modern CSS, so the layout is tables with
 * inline styles. It follows the front page and apps/seams-site/src/styles/h2.css.
 * The wordmark is a PNG because Gmail does not show SVG images; its alt text keeps
 * the brand when images are blocked. Clients without CSS gradients (Gmail, Outlook)
 * show the hero in the middle sage colour.
 */

const SITE_ORIGIN = 'https://seams.sh';
const WORDMARK_URL = `${SITE_ORIGIN}/brand/seams-wordmark-email.png`;
const COMPANY_NAME = 'Seams Technologies KK';

const COLOR = {
  page: '#ffffff',
  panel: '#f5f3f1',
  stone: '#ebe8e4',
  line: '#f2f0ed',
  ink: '#0a0a0a',
  graphite: '#44403b',
  smoke: '#777169',
  ash: '#a59f97',
  /* the front page hero: --h2-gradient-sage */
  sageFrom: '#919690',
  sageTo: '#c7d0cf',
  sageMid: '#acb3ae',
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
  /** The small uppercase label over the heading, as on the site's sections. */
  readonly kicker: string;
  /** The inbox preview line; it is hidden in the message body. */
  readonly preheader: string;
  readonly heading: string;
  readonly blocks: readonly EmailBlock[];
  readonly action: EmailLink | null;
  /** A closing line under the button, such as a safety note. */
  readonly closing?: string;
}

/**
 * The front page in email form: a white page in a column framed by hairlines with
 * black dots where the rules cross, a sage hero card with a light white headline,
 * then the message, a black pill button, and a footer with the wordmark.
 */
export function renderEmailLayoutHtml(input: EmailLayoutInput): string {
  let body = '';
  for (const block of input.blocks) body += renderBlock(block);
  if (input.action) body += renderButton(input.action);
  if (input.closing) body += paragraph(input.closing, COLOR.smoke, '14px', '8px 0 0');
  const frame = `border-left:1px solid ${COLOR.line};border-right:1px solid ${COLOR.line};`;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light">
    <meta name="supported-color-schemes" content="light">
    <title>${escapeHtml(input.heading)}</title>
    <link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@300;400;500;600&amp;display=swap" rel="stylesheet">
  </head>
  <body style="margin:0;padding:0;background:${COLOR.page};color:${COLOR.ink};font-family:${FONT};-webkit-font-smoothing:antialiased;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${COLOR.page};">${escapeHtml(input.preheader)}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="${COLOR.page}" style="background:${COLOR.page};">
      <tr>
        <td align="center" style="padding:24px 12px 40px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;">
            <tr>
              <td style="padding:8px 28px 22px;">
                ${wordmark(24)}
              </td>
            </tr>
            ${ruleRow()}
            <tr>
              <td style="${frame}padding:12px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="${COLOR.sageMid}" style="background-color:${COLOR.sageMid};background-image:linear-gradient(160deg, ${COLOR.sageFrom} 0%, ${COLOR.sageTo} 100%);border-radius:22px;">
                  <tr>
                    <td style="padding:56px 28px 32px;">
                      <p style="margin:0 0 12px;color:rgba(255,255,255,0.82);font-family:${FONT};font-size:11px;font-weight:500;letter-spacing:0.16em;text-transform:uppercase;">${escapeHtml(input.kicker)}</p>
                      <h1 style="margin:0;color:#ffffff;font-family:${FONT};font-size:32px;line-height:1.12;font-weight:300;letter-spacing:-0.02em;">${escapeHtml(input.heading)}</h1>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="${frame}padding:20px 28px 28px;">
                ${body}
              </td>
            </tr>
            ${ruleRow()}
            <tr>
              <td style="padding:24px 28px 0;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                  <tr>
                    <td valign="top" style="padding:0 0 12px;">${wordmark(18)}</td>
                    <td valign="top" align="right" style="padding:2px 0 12px;font-family:${FONT};font-size:13px;line-height:1.6;">
                      <a href="${SITE_ORIGIN}/pricing" style="color:${COLOR.ink};text-decoration:none;">Pricing</a>&nbsp;&nbsp;&nbsp;<a href="${SITE_ORIGIN}/company" style="color:${COLOR.ink};text-decoration:none;">About us</a>
                    </td>
                  </tr>
                </table>
                <p style="margin:0;color:${COLOR.ash};font-family:${FONT};font-size:10.5px;font-weight:500;letter-spacing:0.16em;text-transform:uppercase;">${escapeHtml(COMPANY_NAME)}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function wordmark(height: number): string {
  const width = Math.round((height * 121) / 24);
  return `<a href="${SITE_ORIGIN}" style="text-decoration:none;color:${COLOR.ink};"><img src="${WORDMARK_URL}" width="${width}" height="${height}" alt="seams" style="display:block;border:0;height:${height}px;width:${width}px;color:${COLOR.ink};font-family:${FONT};font-size:${height - 2}px;font-weight:600;"></a>`;
}

/** A hairline across the column, with the site's black dots where it meets the frame. */
function ruleRow(): string {
  const dot = `<td width="3" height="3" bgcolor="${COLOR.ink}" style="width:3px;height:3px;background:${COLOR.ink};font-size:0;line-height:0;">&nbsp;</td>`;
  return `<tr><td style="padding:0;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr>${dot}<td style="font-size:0;line-height:0;"><div style="height:1px;margin:1px 0;background:${COLOR.line};font-size:0;line-height:0;">&nbsp;</div></td>${dot}</tr></table></td></tr>`;
}

function renderBlock(block: EmailBlock): string {
  switch (block.kind) {
    case 'paragraph':
      return paragraph(block.text, COLOR.graphite, '15px', '0 0 16px');
    case 'note':
      return paragraph(block.text, COLOR.smoke, '14px', '0 0 16px');
    case 'code':
      return `<div aria-label="${escapeHtml(block.label)}" style="margin:8px 0 24px;padding:24px 16px;border-radius:22px;background:${COLOR.panel};color:${COLOR.ink};font-family:${MONO};font-size:34px;font-weight:500;letter-spacing:0.28em;text-align:center;">${escapeHtml(block.code)}</div>`;
    case 'links':
      return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 20px;border-top:1px dashed ${COLOR.stone};">${block.items
        .map(
          (item) =>
            `<tr><td style="padding:14px 0;border-bottom:1px dashed ${COLOR.stone};font-family:${FONT};font-size:15px;"><a href="${escapeHtml(item.url)}" style="color:${COLOR.ink};font-weight:500;text-decoration:none;">${escapeHtml(item.label)}</a></td><td align="right" style="padding:14px 0;border-bottom:1px dashed ${COLOR.stone};font-family:${FONT};font-size:18px;line-height:1;"><a href="${escapeHtml(item.url)}" style="color:${COLOR.ink};text-decoration:none;">&rsaquo;</a></td></tr>`,
        )
        .join('')}</table>`;
    case 'facts':
      return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:4px 0 24px;border-top:1px dashed ${COLOR.stone};">${block.rows
        .map(
          (row) =>
            `<tr><td style="padding:12px 12px 12px 0;border-bottom:1px dashed ${COLOR.stone};color:${COLOR.smoke};font-family:${FONT};font-size:14px;">${escapeHtml(row.label)}</td><td align="right" style="padding:12px 0;border-bottom:1px dashed ${COLOR.stone};color:${COLOR.ink};font-family:${FONT};font-size:14px;font-weight:500;">${escapeHtml(row.value)}</td></tr>`,
        )
        .join('')}</table>`;
    default:
      return assertNever(block);
  }
}

function renderButton(action: EmailLink): string {
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:8px 0 20px;"><tr><td bgcolor="${COLOR.ink}" style="border-radius:9999px;background:${COLOR.ink};"><a href="${escapeHtml(action.url)}" style="display:inline-block;padding:14px 24px;border-radius:9999px;background:${COLOR.ink};color:#ffffff;font-family:${FONT};font-size:15px;font-weight:500;line-height:1;text-decoration:none;">${escapeHtml(action.label)}&nbsp;&nbsp;&rsaquo;</a></td></tr></table>`;
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
