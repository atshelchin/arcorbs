# Arc Orbs: the site

The site for Arc Orbs, a game for Vela Wallet accounts played on Arc Testnet.
Someone funds a drop with test USDC; every Vela account pulls one orb from it
and is paid what it holds in the same transaction. The contract is in
`../contracts`.

## Run it

```sh
bun install
bun run dev
```

Nothing needs setting: the site uses the deployed contract and Arc Testnet's
public nodes. `.env.example` lists the two things that can be pointed
elsewhere, for a fork or a new build of the contract.

There is one network. The site knows nothing of Arc's mainnet, and amounts are
written as a number and "test USDC", never with a currency sign: test USDC is
not money, and nothing here should make it look like money.

## What is where

| Path                       | What it is                                                             |
| -------------------------- | ---------------------------------------------------------------------- |
| `src/lib/arc.ts`           | Arc Testnet: chain, nodes, explorer, faucet, the contract's address    |
| `src/lib/wallet.svelte.ts` | Wallet discovery (EIP-6963, then `window.ethereum`) and the connection |
| `src/lib/orbs.ts`          | Reads from the contract, and the three things an account can do        |
| `src/lib/stage/Stage.ts`   | The three.js scene                                                     |
| `src/lib/server/card/`     | The picture a shared link unfolds into                                 |
| `src/routes/`              | The pages: home, `create`, `drop/[id]`, `terms`                        |

## Things that are easy to get wrong

- **Who may play is decided by the contract**, not by the site. The site only
  explains. Any wallet can connect; an account that is not a Vela account sees
  the drops and is told why it cannot pull.
- **A Vela account has no code until its first transaction.** The site cannot
  ask the contract about such an account, so it goes by the wallet that is
  connected and lets the contract decide when the pull lands.
- **A pull is proven by its event, not by the receipt's status.** Vela sends a
  user operation, and one that reverts still lands in a successful transaction.
- **Share cards only carry facts that cannot change.** The apps that show a
  card keep their copy for days. A card for `?by=<account>` reads that
  account's pull from the chain, so a link cannot claim one that never
  happened. Every card is marked TESTNET.

## Deploy it

The site is a Cloudflare Worker: `bun run build`, then `wrangler deploy`.

When Cloudflare builds it from the repository, give the build the variable
`BUN_VERSION`, set to the Bun that wrote `bun.lock` (1.4.2 at the time of
writing). The build image's own Bun is older and cannot read the lockfile, and
the build stops at `bun install` with "Unknown lockfile version". The build's
root directory is `web`.

## Check it

```sh
bun run check      # types
bun run lint       # prettier and eslint
bun run test:unit  # vitest: pure logic in node, components in a browser
bun run build      # the Cloudflare Worker
```

Do not run a second dev server from this directory with other settings while
one is up: both write the same generated files under `.svelte-kit`, and the
first starts reading the second's settings. Copy the directory and run there.
