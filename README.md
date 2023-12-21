# Stellar Tx signers inspector

> Discover required signers, weights, and build optimal signature schema for 
[Stellar](https://stellar.org) transactions and accounts.

## Usage

```
npm i @stellar-expert/tx-signers-inspector
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

## Tests

```
npm run test
```
