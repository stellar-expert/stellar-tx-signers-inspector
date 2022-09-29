import SignatureRequirementsTypes from './signature-requirements-types'

export default class SignatureRequirementsBase {
    constructor(type) {
        if (typeof type !== 'string' && SignatureRequirementsTypes[type] === undefined)
            throw new Error('Invalid type')
        this.type = type
    }
}