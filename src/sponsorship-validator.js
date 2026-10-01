import {normalizeAccountAddress} from './signer-keys.js'

/**
 * Validate CAP-33 sponsorship transactions.
 * @param {Array<Object>} operations - Parsed transaction operations.
 * @param {String} txSource - Transaction source account.
 * @return {Array<SchemaWarning>}
 */
export function validateSponsorships(operations, txSource) {
    const warnings = []
    /** @type {Map<string, {sponsor: string, index: number}>} */
    const sponsored = new Map()
    const isSponsoring = account => [...sponsored.values()].some(({sponsor}) => sponsor === account)

    operations.forEach((operation, index) => {
        const source = normalizeAccountAddress(operation.source || txSource)
        switch (operation.type) {
            case 'beginSponsoringFutureReserves': {
                const {sponsoredId} = operation
                let reason
                if (sponsoredId === source) {
                    reason = 'an account cannot sponsor itself'
                } else if (sponsored.has(sponsoredId)) {
                    reason = `${sponsoredId} is already sponsored`
                } else if (sponsored.has(source) || isSponsoring(sponsoredId)) {
                    reason = 'recursive sponsorships are not allowed'
                }
                if (reason) {
                    warnings.push({
                        code: 'invalid_sponsorship',
                        message: `Operation #${index} cannot sponsor future reserves of ${sponsoredId}: ${reason}.`,
                        data: sponsoredId
                    })
                } else {
                    sponsored.set(sponsoredId, {sponsor: source, index})
                }
            }
                break
            case 'endSponsoringFutureReserves':
                if (!sponsored.delete(source)) {
                    warnings.push({
                        code: 'orphan_sponsorship_end',
                        message: `Operation #${index} ends sponsorship of ${source}, but its future reserves are not sponsored.`,
                        data: source
                    })
                }
                break
        }
    })

    for (const [sponsoredId, {sponsor, index}] of sponsored) {
        warnings.push({
            code: 'unterminated_sponsorship',
            message: `Sponsorship of ${sponsoredId} future reserves by ${sponsor} started in operation #${index} is never ended.`,
            data: sponsoredId
        })
    }
    return warnings
}
