export default class AccountThresholdsDescriptor {
    /**
     * @param {String} accountId - Source account.
     * @param {Number} firstUse - Index of the first operation that uses the account as a source (-1 for tx source).
     */
    constructor(accountId, firstUse) {
        this.id = accountId
        this.firstUse = firstUse
        this.thresholds = {
            low: false,
            med: false,
            high: false
        }
    }

    /**
     * Mark particular threshold level as required.
     * @param {'low'|'med'|'high'} threshold
     */
    setThreshold(threshold) {
        this.thresholds[threshold] = true
    }
}
