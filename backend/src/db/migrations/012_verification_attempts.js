/**
 * Closes a brute-force gap in verifyEmailCode(): a 6-digit code (1,000,000
 * possibilities) had no limit on wrong guesses within its 15-minute window -
 * a scripted attacker could iterate the whole keyspace and mint a session
 * for a targeted account with no password needed. This adds a per-code
 * failed-attempt counter; authService.js invalidates the code outright once
 * it hits MAX_VERIFICATION_ATTEMPTS, forcing a resend (a fresh code and a
 * fresh budget) instead of leaving the same code guessable indefinitely.
 */
const sql = `
ALTER TABLE users ADD COLUMN verification_code_attempts INTEGER NOT NULL DEFAULT 0;
`;

export { sql };
