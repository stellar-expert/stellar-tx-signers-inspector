# Stellar Tx Signers Inspector

> Discover required signers, weights, and build optimal signature schema for 
[Stellar](https://stellar.org) transactions and accounts.

## Usage

Install:

```
npm install @stellar-expert/tx-signers-inspector
```

Import functions:

```js
//ESM
import {inspectTransactionSigners, inspectAccountSigners} from '@stellar-expert/tx-signers-inspector'
//CommonJS
const {inspectTransactionSigners, inspectAccountSigners} = require('@stellar-expert/tx-signers-inspector')
```

### Analyze transaction signers

To analyze transaction signature requirements, we need to build signers schema
first:

```javascript
import {inspectTransactionSigners} from '@stellar-expert/tx-signers-inspector'
//build signatures schema
const schema = await inspectTransactionSigners(tx)
```

#### Discovering all signers that can potentially sign a transaction

Method `getAllPotentialSigners()` returns all signers for all accounts
used as `source` in either the transaction itself or any of its operations.

```js
schema.getAllPotentialSigners()
//returns something like ['GA7...K0M', 'GCF...DLP', 'GA0...MMR']
```

#### Discovering optimal transaction signers

Method `discoverSigners()` returns the list of the optimal signers to use.
It automatically detects weights and performs an advanced lookup to find the best 
signing schema in terms of the minimum signers count. This is especially useful
for complex transactions containing multiple operations with different sources.

```js
schema.discoverSigners()
//returns something like ['GA7...K0M']
```

#### Discovering optimal transaction signers with a restricted list of available signers

Calling `discoverSigners(availableSigners)` with `availableSigners` argument
returns the optimal signature schema (just like calling it without arguments)
respecting the restrictions list. Only explicitly provided signers will be used
for a schema lookup.

```js
schema.discoverSigners(['GCF...DLP', 'GA0...MMR', 'GBP...D71'])
//returns something like ['GCF...DLP', 'GA0...MMR']
```

#### Checking signing feasibility for a transaction 

Method `checkFeasibility(availableSigners)` verifies that the transaction can be
fully signed using a given set of available signers. It returns `true` if
the total weight of the provided signers is sufficient to fully sign the 
transaction and `false` otherwise.

```js
schema.checkFeasibility(['GCF...DLP', 'GA0...MMR', 'GBP...D71'])
//returns true
schema.checkFeasibility(['GA0...MMR', 'GBP...D71'])
//returns false
```

#### Avoiding TX_BAD_AUTH_EXTRA errors

Stellar protocol forbids [transactions signed with excessive number of signers](https://www.stellar.org/developers/guides/concepts/multi-sig.html#thresholds).
Adding more signatures than needed for a transaction results in a
`TX_BAD_AUTH_EXTRA` error. In complex cases it's not easy to detect such
situations automatically and avoid excessive signatures.
Method `checkAuthExtra(availableSigners)` returns a list of signers that can
cause the `TX_BAD_AUTH_EXTRA` error.

```js
schema.checkAuthExtra(['GCF...DLP', 'GA0...MMR'])
//returns []
schema.checkAuthExtra(['GA7...K0M', 'GCF...DLP', 'GA0...MMR'])
//returns ['GCF...DLP', 'GA0...MMR']
```

#### Signer key types

All four Stellar signer key types are accounted for, following Stellar Core signature
verification rules:

- **Ed25519 public keys** (`G...`) are regular signers.
- **SHA-256 hash signers** (`X...`, `SIGNER_KEY_TYPE_HASH_X`) are regular signers as well: the
  "signature" is the hash preimage, which occupies a transaction signature slot.
- **Signed payload signers** (`P...`, `SIGNER_KEY_TYPE_ED25519_SIGNED_PAYLOAD`) are regular signers that
  are different from the Ed25519 key they embed. A plain transaction signature by the embedded key
  doesn't satisfy them.
- **Pre-authorized transaction signers** (`T...`, `SIGNER_KEY_TYPE_PRE_AUTH_TX`) never produce
  signatures. When a pre-auth signer matches the inspected transaction hash, its weight is counted
  automatically. Pre-auth signers of other transactions are ignored.
  - Pre-auth signers are never returned by `getAllPotentialSigners()`, `discoverSigners()`, or
    `checkAuthExtra()`.
  - A transaction fully authorized by a pre-auth signer needs no signatures, so `discoverSigners()`
    returns `[]` while `checkFeasibility([])` returns `true`.
  - A pre-auth `extraSigners` key can never match the hash of its own transaction. It makes the
    schema unsatisfiable and is reported with an `unsatisfiable_extra_signer` warning.

#### Soroban authorization entries

Address credentials in Soroban authorization entries (`invokeHostFunction` operations) need
signatures separate from the transaction envelope signatures. Entries with source account
credentials are authorized by the operation source account signature and need nothing extra.

Authorization entries are analyzed by default. Authorizing Stellar accounts are loaded from Horizon
(or taken from `accountsInfo`):

```js
const schema = await inspectTransactionSigners(tx)
//transaction envelope signers
schema.discoverSigners()
//one schema per authorization entry with address credentials
for (const auth of schema.sorobanAuth) {
    auth.address             //top-level credentials address, 'G...' or 'C...'
    auth.credentialsType     //'address', 'address_v2' (CAP-71-02), or 'address_with_delegates' (CAP-71-01)
    auth.requirements        //one node per address that needs to authenticate
    auth.discoverSigners()   //public keys that need to sign the entry payload
    auth.checkFeasibility(['GA7...K0M'])
    auth.getSignaturePayload() //32-byte payload signed by every node of the entry
    auth.verifySignatures()  //validate the signatures already attached to the entry
}
```

To skip the analysis, set `sorobanAuth: false`. In this case `schema.sorobanAuth` is empty, and every
entry that needs a separate signature is reported with a `soroban_auth` warning instead.

The signature scheme discovery follows Soroban host authentication rules:

- **Stellar accounts** authenticate with the **medium** threshold. Only Ed25519 signers (the master
  key and `ed25519_public_key` signers) count; pre-auth, hash-x and signed payload signers can't sign
  Soroban payloads.
- **Custom accounts** (contracts) authenticate in their `__check_auth` function, which can't be
  evaluated offline. They are reported with a `custom_account_auth` warning and treated as
  satisfiable. `verifySignatures()` returns `valid: null` for them.
- **Delegated signers** (CAP-71-01, `SOROBAN_CREDENTIALS_ADDRESS_WITH_DELEGATES`) of custom accounts
  are analyzed recursively. Each node's `path` gives its position in the delegates tree (`[]` for the
  top-level address). All delegates sign the same address-bound payload of the top-level address.
  Delegates attached to a Stellar account are ignored by the host and reported with an
  `ignored_soroban_delegates` warning.
- **Payloads.** Legacy `address` credentials sign the `ENVELOPE_TYPE_SOROBAN_AUTHORIZATION` preimage.
  `address_v2` (CAP-71-02) and `address_with_delegates` credentials sign the address-bound
  `ENVELOPE_TYPE_SOROBAN_AUTHORIZATION_WITH_ADDRESS` preimage.

`verifySignatures()` returns one result per node,
`{id, path, signed, valid, signers, weight, errors}`. It checks the attached Ed25519 signatures
against the payload, signature ordering and count, signer weights, the medium threshold, and
delegates ordering.

Authorization entries are part of the transaction body. They need to be signed before signing the transaction
envelope.

#### Sponsorship

Sponsorship operations don't require signers beyond their operation sources. However, a sponsored
account created within the same transaction must sign it with its master key, because it's the
source of the `endSponsoringFutureReserves` operation. No `no_source` warning is reported for
accounts created by the transaction before their first use.

Mismatched sponsorship "sandwiches" make the transaction fail and are reported with these warnings:

- `invalid_sponsorship`: self, repeated, or recursive sponsorship.
- `orphan_sponsorship_end`: an end operation without an active sponsorship.
- `unterminated_sponsorship`: a sponsorship that is never ended.

### Analyze account signers

Accounts signing requirements can be analyzed similar to transactions.

```js
import {inspectAccountSigners} from '@stellar-expert/tx-signers-inspector'
//build signatures schema for an account
const schema = await inspectAccountSigners('GDF...ER2')
```

#### Discovering all account signers

Method `getAllPotentialSigners()` returns all account signers.

```js
schema.getAllPotentialSigners()
//returns something like ['GA7...K0M', 'GCF...DLP', 'GA0...MMR']
```

#### Discovering optimal account signers for a given threshold

Method `discoverSigners(weight)` returns the list of the optimal signers to
match the required signatures weight.

```js
schema.discoverSigners('low')
//returns something like ['GA7...K0M']
```

#### Discovering optimal account signers for a given threshold with a restricted list of available signers

Calling `discoverSigners(weight, availableSigners)` with `availableSigners`
argument returns the optimal signature schema to match the required signatures 
weight (just like calling it without arguments) respecting the restrictions list.
Only explicitly provided signers will be used for a schema lookup.

```js
schema.discoverSigners('med', ['GCF...DLP', 'GA0...MMR', 'GBP...D71'])
//returns something like ['GCF...DLP', 'GA0...MMR']
```

#### Checking account signing feasibility for a given threshold

Method `checkFeasibility(weight, availableSigners)` verifies that the 
transaction with a given threshold can be fully signed using a given set of
available signers. It returns `true` if the total weight of the provided signers
is sufficient to meet the threshold requirements and `false` otherwise. 

```js
schema.checkFeasibility('med', ['GCF...DLP', 'GA0...MMR'])
//returns true
schema.checkFeasibility('high', ['GCF...DLP', 'GA0...MMR'])
//returns false
```

#### Avoiding TX_BAD_AUTH_EXTRA errors for a given account threshold

Method `checkAuthExtra(weight, availableSigners)` returns a list of signers that
can cause the `TX_BAD_AUTH_EXTRA` error when signing a transaction the requires 
a given account threshold.

```js
schema.checkAuthExtra('med', ['GCF...DLP', 'GA0...MMR'])
//returns []
schema.checkAuthExtra('med', ['GA7...K0M', 'GCF...DLP', 'GA0...MMR'])
//returns ['GCF...DLP', 'GA0...MMR']
```

### Options

The analyzers automatically fetch the required accounts information from Horizon.
By default, `https://horizon.stellar.org` is used. To use testnet Horizon address
or you own server, provide `horizon` options parameter in the 
`inspectTransactionSigners()` or `inspectAccountSigners()` method call: 

```js
//use testnet Horizon server instead of the default address
const schema = await inspectTransactionSigners(tx, 
    {horizon: 'https://horizon-testnet.stellar.org'})
```

To deal with cases where some account doesn't exist yet, it's possible to
provide accounts information directly:

```js
//provide account information directly
const schema = await inspectTransactionSigners(tx, {accountsInfo: [
    {
      account_id: 'GAU...DOE',
      id: 'GAU...DOE',
      sequence: '2',
      subentry_count: 0,
      signers: [
        {
          type: 'ed25519_public_key',
          key: 'GAU...DOE',
          weight: 1
        }
      ],
      thresholds: {
        low_threshold: 0,
        med_threshold: 0,
        high_threshold: 0
      }
    }
]})
```

### Warnings

Every schema exposes a `warnings` array describing conditions that can't be fully verified at
analysis time. Each entry has the shape `{code, message, data}`:

```js
const schema = await inspectTransactionSigners(tx)
schema.warnings
//[{
//   code: 'no_source',
//   message: 'Source account GAU...DOE does not exist on the ledger.',
//   data: 'GAU...DOE'
//}]
```

| Code                         | Schema          | Description                                                               |
|------------------------------|-----------------|---------------------------------------------------------------------------|
| `no_source`                  | tx, account     | Source account doesn't exist and isn't created by the tx before use       |
| `unsatisfiable_extra_signer` | tx              | Pre-auth `extraSigners` key can never match the transaction hash          |
| `invalid_sponsorship`        | tx              | Self, repeated, or recursive `beginSponsoringFutureReserves`              |
| `orphan_sponsorship_end`     | tx              | `endSponsoringFutureReserves` without an active sponsorship               |
| `unterminated_sponsorship`   | tx              | `beginSponsoringFutureReserves` that is never ended                       |
| `soroban_auth`               | tx              | Soroban auth entry needs a separate signature (`sorobanAuth` option off)  |
| `custom_account_auth`        | Soroban auth    | Authentication is defined by a custom account contract                    |
| `ignored_soroban_delegates`  | Soroban auth    | Delegated signers attached to a Stellar account are ignored               |
| `no_auth_account`            | Soroban auth    | Authorizing Stellar account doesn't exist on the ledger                   |
| `unsupported_auth_address`   | Soroban auth    | Address type can't be used in Soroban credentials                         |

## Building

```
npm build
```

Produces the UMD bundle in `lib/`. `@stellar/stellar-sdk` is treated as an external dependency
and is expected to be available as the `StellarSdk` global in browser environments.

## Tests

```
npm test
```
