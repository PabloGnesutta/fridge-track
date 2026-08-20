/**
 * Per-user opt-out toggles for the two notification channels (push actually
 * wired to the scheduler below; email has no trigger yet - see
 * emailService.js - so this column is just persisted ahead of that). Both
 * default to enabled so existing push-subscribed users keep getting
 * notified after this ships without having to flip anything themselves;
 * "no explicit disable" already meant "send" before this migration existed,
 * this just makes that opt-out an explicit, user-controlled column instead
 * of an implicit default.
 */
const sql = `
ALTER TABLE users ADD COLUMN push_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN email_enabled INTEGER NOT NULL DEFAULT 1;
`;

export { sql };
