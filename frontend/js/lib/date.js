/**
 * Returns a "time ago" string.
 * @param {string | Date} input 
 * @returns {string}
 */
function timeAgo(input = '') {
    const date = (input instanceof Date) ? input : new Date(input);
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (isNaN(seconds)) { return "¡!"; }

    /** 
     * Will account for entire days passed. 
     * So, if the date is yesterday but less than 24 hours ago, it will yield 0.
     */
    const wholeDaysPassed = Math.floor(seconds / 60 / 60 / 24);
    if (wholeDaysPassed < 1) {
        // Hack due to the nature of wholeDaysPassed
        if (date.getDate() === new Date().getDate()) {
            return "hoy";
        } else {
            return 'ayer';
        }
    }
    if (wholeDaysPassed === 1) { return "ayer"; }

    const labels = [
        { label: 'año', days: 365 },
        { label: 'mes', pl: 'es', days: 30 },
        { label: 'semana', days: 7 },
        { label: 'día', days: 1 },
    ];
    for (const { label, pl, days } of labels) {
        if (wholeDaysPassed < days) { continue; }
        const amount = Math.floor(wholeDaysPassed / days);
        const remainder = wholeDaysPassed % days;
        return `${amount} ${label}` + (amount > 1 ? (pl || 's') : '') + (remainder ? '+' : '');
    }

    return '¿?';
}


/**
 * @param {Date} date
 * @returns {string}
 */
function toYYYYMMDD(date) {
    let strYear = date.getFullYear().toString();

    const month = date.getMonth() + 1;
    let strMonth = month.toString();
    if (month < 10) strMonth = '0' + strMonth;

    const day = date.getDate();
    let strDay = day.toString();
    if (day < 10) strDay = '0' + strDay;

    return strYear + '-' + strMonth + '-' + strDay;
}


/**
 * Parses a "YYYY-MM-DD" string (e.g. from a date input) as local midnight,
 * not UTC midnight. `new Date("YYYY-MM-DD")` parses as UTC, which silently
 * shifts the calendar day by the timezone offset for anyone not on UTC+0.
 * @param {string} str
 * @returns {Date}
 */
function fromYYYYMMDD(str) {
    const [year, month, day] = str.split('-').map(Number);
    return new Date(year, month - 1, day);
}


const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MONTHS = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

/**
 * @param {Date} date
 * @returns {string} e.g. "martes 1 de agosto"
 */
function formatReadableDate(date) {
    return `${WEEKDAYS[date.getDay()]} ${date.getDate()} de ${MONTHS[date.getMonth()]}`;
}


export { timeAgo, toYYYYMMDD, fromYYYYMMDD, formatReadableDate };