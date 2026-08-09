
/**
 * @param {string} s 
 * @returns {string}
 */
function normalize(s) {
    var normalized = s.trim().toLocaleLowerCase()
    return normalized
}

/**
 * @param {string} input 
 * @param {string} pattern 
 * @returns {boolean}
 */
function matches(input, pattern) {
    return new RegExp(pattern, "i").test(input);
}


export { normalize, matches }