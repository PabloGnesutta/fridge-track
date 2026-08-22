/**
 * New-signup email confirmation, on top of the existing allowed_emails
 * white list (see db/allowedEmails.js) - the white list still gates *who can
 * sign up at all*; this adds a second, per-user gate that a real inbox was
 * reached before the account can log in. A 6-digit code + expiry stored
 * directly on `users`, the same "simple per-row columns, not a separate
 * table" call already made for push/email prefs in migration 004 - only one
 * code is ever live per user at a time, so there's nothing a join table would
 * buy here.
 *
 * `email_verified` defaults to 1 (not 0) specifically so this ALTER TABLE
 * backfills every already-existing user as verified - they signed up under
 * the old no-verification flow and have no code to enter, so gating their
 * next login would lock them out with no way back in. New signups are
 * unaffected by this default: authService.createUser() always inserts
 * email_verified explicitly as 0, the same way DEFAULT 1 on migration 004's
 * columns never stopped app code from writing an explicit 0/1 of its own.
 */
const sql = `
ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN verification_code TEXT;
ALTER TABLE users ADD COLUMN verification_code_sent_at INTEGER;
ALTER TABLE users ADD COLUMN verification_code_expires_at INTEGER;
`;

export { sql };
