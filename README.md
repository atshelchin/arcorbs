# Arc Orbs

A game for [Vela Wallet](https://getvela.app) accounts, played on Arc Testnet.

Someone funds a drop with test USDC and splits it into a ring of orbs. Every
Vela account pulls one orb from it, and the contract pays what the orb holds in
the same transaction. How much that is, is random — and random in the same way
for whoever pulls first, last or in between.

It is played with test USDC, which is free from a faucet and worth nothing.
That is the point: Arc Orbs is a game, not a giveaway, and it is not deployed
anywhere USDC is money.

Play it at [arcorbs.game3.app](https://arcorbs.game3.app).

## What is here

| Path                      | What it is                                                                                |
| ------------------------- | ----------------------------------------------------------------------------------------- |
| [`contracts/`](contracts) | The `ArcOrbs` contract and the check that tells a Vela account from any other, in Foundry |
| [`web/`](web)             | The site: SvelteKit on Cloudflare Workers, with a three.js scene                          |

Each has its own README with how to run and test it.

## The contract

`ArcOrbs` is deployed on Arc Testnet (chain id 5042002) at
[`0x0e7eee70d68E2b7Cfaf21D51C7D401391c27829b`](https://testnet.arcscan.app/address/0x0e7eee70d68E2b7Cfaf21D51C7D401391c27829b).
It has no owner and cannot be changed. It has not been audited.

## Licence

[MIT](LICENSE). The fonts in `web/src/lib/server/card` are Plus Jakarta Sans,
under the SIL Open Font License beside them. `contracts/lib` holds forge-std and
one file of Solady, each under its own licence.
