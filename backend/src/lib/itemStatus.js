/**
 * Deliberate backend-local port of the expired/expiring-soon decision from
 * frontend/js/lib/freshnessStatus.js's computeStatus() - the two npm
 * projects don't share code, and the scheduler needs to make this call
 * server-side against the synced `items` table. Keep the threshold and
 * "expired if either signal has elapsed" logic identical to the original;
 * if one changes, change the other too.
 */

const EXPIRING_SOON_DAYS = 2;
const MS_PER_DAY = 1000 * 60 * 60 * 24;

/**
 * @param {Date} from
 * @param {Date} to
 * @returns {number}
 */
function daysBetween(from, to) {
  const fromMidnight = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const toMidnight = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((toMidnight.getTime() - fromMidnight.getTime()) / MS_PER_DAY);
}

/**
 * @param {Date} date
 * @param {number} days
 * @returns {Date}
 */
function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

/**
 * @param {{useByDate: number|null, addedDate: number|null, shelfLifeDays: number|null}} item
 * @param {Date} [currentDate]
 * @returns {'fresh'|'expiring-soon'|'expired'}
 */
function computeItemStatus(item, currentDate = new Date()) {
  const daysUntilUseBy = item.useByDate
    ? daysBetween(currentDate, new Date(item.useByDate))
    : null;

  const daysUntilShelfLifeEnd = (item.shelfLifeDays != null && item.addedDate)
    ? daysBetween(currentDate, addDays(new Date(item.addedDate), item.shelfLifeDays))
    : null;

  const expired = (daysUntilUseBy !== null && daysUntilUseBy <= 0)
    || (daysUntilShelfLifeEnd !== null && daysUntilShelfLifeEnd <= 0);
  if (expired) { return 'expired'; }

  const expiringSoon = (daysUntilUseBy !== null && daysUntilUseBy <= EXPIRING_SOON_DAYS)
    || (daysUntilShelfLifeEnd !== null && daysUntilShelfLifeEnd <= EXPIRING_SOON_DAYS);
  return expiringSoon ? 'expiring-soon' : 'fresh';
}

/**
 * The number of days until the soonest of the two due signals is reached
 * (negative when already past), or null if the item has neither. Mirrors
 * frontend/js/lib/freshnessStatus.js's getSoonestDays() - used to rank
 * items by actual urgency rather than just their status bucket (e.g. for
 * recipe-suggestion ingredient picking).
 * @param {{useByDate: number|null, addedDate: number|null, shelfLifeDays: number|null}} item
 * @param {Date} [currentDate]
 * @returns {number|null}
 */
function getDaysUntilDue(item, currentDate = new Date()) {
  const daysUntilUseBy = item.useByDate
    ? daysBetween(currentDate, new Date(item.useByDate))
    : null;

  const daysUntilShelfLifeEnd = (item.shelfLifeDays != null && item.addedDate)
    ? daysBetween(currentDate, addDays(new Date(item.addedDate), item.shelfLifeDays))
    : null;

  const days = [daysUntilUseBy, daysUntilShelfLifeEnd].filter(d => d !== null);
  if (!days.length) { return null; }
  return Math.min(...days);
}

export { computeItemStatus, getDaysUntilDue, EXPIRING_SOON_DAYS };
