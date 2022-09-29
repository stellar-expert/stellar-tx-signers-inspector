export default class AccountThresholdsDescriptor {
    /**
     * @param {String} accountId - Source account.
     */
    constructor(accountId) {
        this.id = accountId
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