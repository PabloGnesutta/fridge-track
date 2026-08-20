/**
 * Turns a plain-text email body into a self-contained HTML document with
 * inline CSS (no <style> block, no external stylesheet/font/image - some
 * mail clients strip <style> tags or block remote requests entirely). Pure
 * and dependency-free on purpose: no templating library, nothing project-
 * specific, so this file can be copied into another project as-is.
 */

/** @param {string} value */
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Blank-line-separated paragraphs become <p> tags; single newlines within a
 * paragraph become <br>, so a caller can pass an ordinary multi-line string
 * without writing any HTML.
 * @param {string} text
 */
function textToHtmlParagraphs(text) {
  return String(text)
    .split(/\n{2,}/)
    .map(paragraph => escapeHtml(paragraph).replace(/\n/g, '<br>'))
    .filter(Boolean)
    .map(paragraph => `<p style="margin:0 0 16px;">${paragraph}</p>`)
    .join('');
}

/**
 * @param {{title?: string, bodyText: string, appName?: string}} opts
 *   title: optional heading shown above the body (e.g. the email subject).
 *   bodyText: plain-text body, wrapped into <p>/<br> automatically.
 *   appName: shown in the header bar; defaults to a generic label so this
 *     stays portable without per-project configuration.
 * @returns {string} a full <!doctype html> document
 */
function renderEmailHtml({ title, bodyText, appName = 'App' }) {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="width:480px;max-width:90vw;background:#ffffff;border-radius:8px;overflow:hidden;">
            <tr>
              <td style="background:#111827;padding:20px 24px;">
                <span style="color:#ffffff;font-size:16px;font-weight:600;">${escapeHtml(appName)}</span>
              </td>
            </tr>
            <tr>
              <td style="padding:24px;color:#111827;font-size:15px;line-height:1.5;">
                ${title ? `<h1 style="margin:0 0 16px;font-size:18px;">${escapeHtml(title)}</h1>` : ''}
                ${textToHtmlParagraphs(bodyText)}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export { renderEmailHtml, escapeHtml };
