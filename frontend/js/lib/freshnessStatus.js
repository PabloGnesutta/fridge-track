/**
 * @typedef {'fresh'|'expiring-soon'|'expired'} FreshnessStatus
 * @typedef {{ status: FreshnessStatus, daysUntilUseBy: number|null, daysUntilShelfLifeEnd: number|null }} StatusResult
 */

const EXPIRING_SOON_DAYS = 2;
const MS_PER_DAY = 1000 * 60 * 60 * 24;

/**
 * Computes whether a food item is fresh, expiring soon, or expired, based on
 * today's date vs. its use-by date and/or its shelf-life-from-added-date.
 * Expired when EITHER signal has elapsed.
 * @param {import("../local-db/item-db.js").Item} item
 * @param {Date} [currentDate]
 * @returns {StatusResult}
 */
function computeStatus(item, currentDate = new Date()) {
  const daysUntilUseBy = item.useByDate
    ? daysBetween(currentDate, item.useByDate)
    : null;

  const daysUntilShelfLifeEnd = (item.shelfLifeDays != null && item.addedDate)
    ? daysBetween(currentDate, addDays(item.addedDate, item.shelfLifeDays))
    : null;

  const expired = (daysUntilUseBy !== null && daysUntilUseBy <= 0)
    || (daysUntilShelfLifeEnd !== null && daysUntilShelfLifeEnd <= 0);
  const expiringSoon = !expired && (
    (daysUntilUseBy !== null && daysUntilUseBy <= EXPIRING_SOON_DAYS) ||
    (daysUntilShelfLifeEnd !== null && daysUntilShelfLifeEnd <= EXPIRING_SOON_DAYS)
  );

  return {
    status: expired ? 'expired' : (expiringSoon ? 'expiring-soon' : 'fresh'),
    daysUntilUseBy,
    daysUntilShelfLifeEnd,
  };
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
 * Whole calendar days between two dates (ignores time-of-day, so the result
 * doesn't drift depending on what time "now" happens to be).
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
 * The number of days until the soonest of the two due signals is reached
 * (negative when already past). Used both for display and for sorting items
 * by actual urgency rather than just their status bucket.
 * @param {StatusResult} result
 * @returns {number|null}
 */
function getSoonestDays({ daysUntilUseBy, daysUntilShelfLifeEnd }) {
  const days = [daysUntilUseBy, daysUntilShelfLifeEnd].filter(d => d !== null);
  if (!days.length) { return null; }
  return Math.min(...days);
}

/**
 * Spanish label for the due-detail row, e.g. "vence en 2 días" or
 * "vencido hace 1 día".
 * @param {StatusResult} result
 * @returns {string}
 */
function formatDueDetail(result) {
  const soonest = getSoonestDays(result);
  if (soonest === null) { return 'Sin datos'; }
  if (soonest > 0) { return `vence en ${soonest} día${soonest === 1 ? '' : 's'}`; }
  if (soonest === 0) { return 'vence hoy'; }
  const overdue = -soonest;
  return `vencido hace ${overdue} día${overdue === 1 ? '' : 's'}`;
}


export { computeStatus, formatDueDetail, getSoonestDays };
