# Arc Orbs contracts

`ArcOrbs.sol` is the game: anyone with a Vela Wallet account funds a drop with
USDC, Arc's native coin, and splits it into a number of prizes. Every Vela
account may draw once per drop and is paid in the same transaction.

It is deployed on Arc Testnet only, where USDC is free and worth nothing. That
is what makes it a game. The contract itself would run anywhere Arc's
contracts are; deploying it where USDC is money is a different undertaking,
with gambling and promotion law to answer to in most countries.

Prizes are cut the way a length is cut at random points: an even share on
average, usually less, now and then several times as much, and never less than
a cent. That cut treats every place in the queue alike, which sizing each
draw against the running average does not: `test_draw_everyPlaceInTheQueueHasTheSameOdds`
holds it to that.

`VelaWallet.sol` decides who a Vela account is. A Vela address is a pure
function of its founding passkeys, so the library reads the keys back from the
chain, derives the address Vela would have given them, and compares it with the
caller. Nothing else can produce a matching address.

## Test

```sh
forge test
```

`VelaWallet.t.sol` checks the derivation against vela-core's own vectors.
`ArcOrbsFork.t.sol` founds real wallets through Safe's deployed contracts on a
fork of Arc, and is skipped unless a node is named:

```sh
ARC_RPC_URL=https://rpc.testnet.arc.network forge test --match-contract ArcOrbsForkTest
```

## Deploy

The deployer needs a little test USDC for gas, from the faucet at
https://faucet.circle.com.

```sh
forge script script/Deploy.s.sol --rpc-url arc_testnet --broadcast --account <keystore>
```

The site carries the deployed address in `web/src/lib/arc.ts`; a new build of
the contract goes there, and into `erc7730/arc-orbs.json`.

Then publish the source on the explorer, which needs no API key:

```sh
forge verify-contract <address> src/ArcOrbs.sol:ArcOrbs --chain-id 5042002 \
  --verifier blockscout --verifier-url https://explorer.testnet.arc.io/api/ --watch
```

The contract names the game's website in `WEBSITE`, and a contract cannot be
changed. Whoever holds that domain is who the contract points people to, for as
long as the contract is in use.

## Deployments

| Network     | Chain id | ArcOrbs                                      |
| ----------- | -------- | -------------------------------------------- |
| Arc Testnet | 5042002  | `0x0e7eee70d68E2b7Cfaf21D51C7D401391c27829b` |

Two earlier builds on the testnet are not used any more:
`0x658C688Ba755cE78a16385e6c14F460aA13B7f13` names another website, and
`0xf9514f0FaFfFD0ba028B54883bFd98cFD24dE901` sized draws against the running
average.

## Clear signing

Vela Wallet shows a call it cannot decode as a blind signature. `erc7730/arc-orbs.json`
is the ERC-7730 descriptor that lets it say "Fund a drop" or "Pull an orb"
instead. Vela looks a descriptor up by chain and address, in its chain-data
source ([ethereum-data](https://github.com/atshelchin/ethereum-data)):

```
erc7730/calldata/eip155-<chain id>/<contract address, lowercase>.json
```

So for each deployment, add its address to the descriptor's `deployments` and
publish a copy under that name.

## What to know

- **One account is not one person.** The limit is one draw per Vela account,
  and a person can create more than one account.
- **The randomness is for a game.** Arc's `prevrandao` is always zero, so a
  draw is seeded from the previous block hash and from every earlier draw.
  Whoever orders a block can influence it.
- **One dependency.** `lib/solady` holds a single file of Solady 0.1.26,
  `FixedPointMathLib`, for the `exp` and `ln` the prize cut needs.
- **There is no owner and no upgrade.** A drop's USDC can only leave as prizes,
  or back to its creator once the drop has closed.
