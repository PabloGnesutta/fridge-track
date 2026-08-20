import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderEmailHtml, escapeHtml } from '../src/lib/emailTemplate.js';

test('escapeHtml neutralizes markup-significant characters', () => {
  assert.equal(escapeHtml(`<script>alert('x')</script> & "quotes"`),
    '&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt; &amp; &quot;quotes&quot;');
});

test('renderEmailHtml embeds the title and body text', () => {
  const html = renderEmailHtml({ title: 'Hola', bodyText: 'Tu leche vence pronto.', appName: 'FridgeTrack' });
  assert.match(html, /<!doctype html>/);
  assert.match(html, /FridgeTrack/);
  assert.match(html, /Hola/);
  assert.match(html, /Tu leche vence pronto\./);
});

test('renderEmailHtml escapes body text instead of injecting raw HTML', () => {
  const html = renderEmailHtml({ bodyText: '<b>hi</b>' });
  assert.doesNotMatch(html, /<b>hi<\/b>/);
  assert.match(html, /&lt;b&gt;hi&lt;\/b&gt;/);
});

test('renderEmailHtml turns blank-line-separated text into paragraphs', () => {
  const html = renderEmailHtml({ bodyText: 'Primero.\n\nSegundo.' });
  const paragraphCount = (html.match(/<p /g) || []).length;
  assert.equal(paragraphCount, 2);
});

test('renderEmailHtml turns single newlines within a paragraph into <br>', () => {
  const html = renderEmailHtml({ bodyText: 'Linea uno\nLinea dos' });
  assert.match(html, /Linea uno<br>Linea dos/);
});

test('renderEmailHtml omits the heading when no title is given', () => {
  const html = renderEmailHtml({ bodyText: 'Solo cuerpo.' });
  assert.doesNotMatch(html, /<h1/);
});
