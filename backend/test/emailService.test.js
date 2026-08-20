import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEmailService } from '../src/services/emailService.js';

function makeStubMailClient() {
  const sent = [];
  return {
    sent,
    getMailTransport: () => ({
      sendMail: async message => { sent.push(message); return { messageId: 'stub-id' }; },
    }),
  };
}

test('sendEmail auto-generates HTML from plain text, forwards both to the transport, and returns true', async t => {
  t.mock.method(console, 'log', () => {});
  const mailClient = makeStubMailClient();
  const emailService = createEmailService(mailClient);

  const result = await emailService.sendEmail({ to: 'a@test.local', subject: 'Vencimiento', text: 'Tu leche vence pronto.' });

  assert.equal(result, true);
  assert.equal(mailClient.sent.length, 1);
  const message = mailClient.sent[0];
  assert.equal(message.to, 'a@test.local');
  assert.equal(message.subject, 'Vencimiento');
  assert.equal(message.text, 'Tu leche vence pronto.');
  assert.match(message.html, /<!doctype html>/);
  assert.match(message.html, /Tu leche vence pronto\./);
});

test('sendEmail respects an explicit html override instead of generating one', async t => {
  t.mock.method(console, 'log', () => {});
  const mailClient = makeStubMailClient();
  const emailService = createEmailService(mailClient);

  await emailService.sendEmail({ to: 'a@test.local', subject: 'Custom', html: '<p>custom</p>' });

  assert.equal(mailClient.sent[0].html, '<p>custom</p>');
});

test('sendEmail logs and returns false when "to" is missing, without calling the transport', async t => {
  t.mock.method(console, 'error', () => {});
  const mailClient = makeStubMailClient();
  const emailService = createEmailService(mailClient);

  const result = await emailService.sendEmail({ subject: 'x', text: 'y' });

  assert.equal(result, false);
  assert.equal(mailClient.sent.length, 0);
});

test('sendEmail logs and returns false when neither text nor html is given', async t => {
  t.mock.method(console, 'error', () => {});
  const emailService = createEmailService(makeStubMailClient());

  const result = await emailService.sendEmail({ to: 'a@test.local', subject: 'x' });

  assert.equal(result, false);
});

test('sendEmail logs and returns false on a transport failure instead of throwing', async t => {
  t.mock.method(console, 'error', () => {});
  const mailClient = {
    getMailTransport: () => ({
      sendMail: async () => { throw new Error('SMTP down'); },
    }),
  };
  const emailService = createEmailService(mailClient);

  const result = await emailService.sendEmail({ to: 'a@test.local', subject: 'x', text: 'y' });

  assert.equal(result, false);
});
