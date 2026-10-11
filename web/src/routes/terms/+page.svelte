<script lang="ts">
	import { arc, COIN, explorerAddress, orbsAddress } from '#lib/arc.ts';
	import { BRAND, SOURCE } from '#lib/brand.ts';
	import ExternalLink from '#lib/components/ExternalLink.svelte';
</script>

<svelte:head>
	<title>Terms — {BRAND}</title>
</svelte:head>

<main>
	<h1>Terms</h1>
	<p class="updated">Last updated: 11 October 2026</p>

	<p class="summary">
		In short: {BRAND} is a game. It is played with {COIN}, which is free and worth nothing, so
		nothing you fund or pull here is worth anything either. The game runs on a public smart contract
		that nobody can change or reverse, us included.
	</p>

	<h2>1. What {BRAND} is</h2>
	<p>
		{BRAND} is an experimental game on {arc.name}, published as it is. There are two parts to it: a
		public smart contract, which holds the {COIN} and makes every payment, and this website, which is
		one way to use the contract. In these terms, "we" means the people who publish this website.
	</p>
	<p>
		By funding a drop or pulling an orb you agree to these terms. If you do not agree, do not play.
		{BRAND} works only with Vela Wallet accounts; the wallet itself is covered by
		<a href="https://getvela.app/terms" target="_blank" rel="noopener">Vela Wallet's own terms</a>.
	</p>

	<h2>2. Test USDC is not money</h2>
	<ul>
		<li>
			{BRAND} is played only on a test network. The USDC there is handed out free by a faucet, cannot
			be exchanged for anything, and is worth nothing.
		</li>
		<li>
			So what an orb holds is worth nothing. It is a number in a game. We make no promise that it
			will ever be worth anything, or that playing earns you anything on any other network.
		</li>
		<li>
			Do not buy or sell {COIN}, and do not pay or charge anyone for a pull. Do not use drops to
			settle a bet. Anyone offering you {BRAND} prizes for real money is not us.
		</li>
	</ul>

	<h2>3. Playing</h2>
	<ul>
		<li>
			You need a Vela Wallet account, you must be at least 18, and playing must be allowed by the
			laws that apply to you.
		</li>
		<li>
			A drop is funded by the account that created it. Anyone with a Vela account can fund one, and
			nobody checks who does. Whoever funds a drop can take back what nobody pulled, but only after
			the drop has closed.
		</li>
		<li>
			Each Vela account gets one pull per drop. What an orb holds is decided by the contract when
			you pull, at random. An account is not a person: one person may be using several.
		</li>
		<li>
			The note on a drop is public and permanent. Put nothing in it that is private, unlawful or
			someone else's.
		</li>
	</ul>

	<h2>4. The contract</h2>
	<ul>
		<li>
			Its code is public and has not been independently audited. A defect in it could lose what it
			holds.
		</li>
		<li>
			It has no owner. Nobody, including us, can pause it, change it, reverse a pull or take back a
			drop before it closes.
		</li>
		<li>
			A test network can be reset or switched off by whoever runs it. Everything here may disappear
			without notice.
		</li>
	</ul>
	<p>
		The contract is at
		<ExternalLink class="mono" href={explorerAddress(orbsAddress)}>{orbsAddress}</ExternalLink>, and
		all of the code is at
		<ExternalLink href={SOURCE}>{SOURCE.replace('https://', '')}</ExternalLink>.
	</p>

	<h2>5. What you show by playing</h2>
	<p>
		{BRAND} has no sign-up and asks for no personal details. What you do happens on a public blockchain:
		the account you play from, the drops it funded and what it pulled are visible to anyone, on this website
		and elsewhere, and cannot be removed. Like any website, the servers that deliver this one see the
		address your device connects from.
	</p>

	<h2>6. No promises</h2>
	<p>
		{BRAND} is provided as it is, without warranty of any kind, to the extent the law allows. It may be
		slow, wrong, unavailable, changed or withdrawn at any time. Nothing on this website is financial,
		tax or legal advice. Arc and USDC are run by others, who do not run {BRAND} and are not responsible
		for it.
	</p>
	<p>
		To the maximum extent permitted by law, the people who made and publish {BRAND} are not liable for
		any loss arising from your use of it. Nothing in these terms limits or excludes liability that cannot
		be limited or excluded by law.
	</p>

	<h2>7. Changes and contact</h2>
	<p>
		We may update these terms; the date at the top of this page changes when we do. Reach the maker
		on X:
		<a href="https://x.com/atshelchin" target="_blank" rel="noopener">@atshelchin</a>.
	</p>
</main>

<style>
	main {
		max-width: 720px;
		margin: 0 auto;
		padding: calc(var(--header) + 48px) var(--gutter) calc(64px + env(safe-area-inset-bottom));
	}

	h1 {
		font-size: clamp(34px, 6vw, 48px);
		font-weight: 800;
		letter-spacing: -0.03em;
		line-height: 1.1;
	}

	.updated {
		margin-top: 8px;
		font-size: 14px;
		color: var(--fg-subtle);
	}

	.summary {
		margin-top: 28px;
		padding: 16px 18px;
		border: 1px solid var(--border-strong);
		border-radius: 14px;
		background: var(--bg-raised);
		color: var(--fg);
	}

	h2 {
		margin-top: 40px;
		font-size: 20px;
		font-weight: 700;
		letter-spacing: -0.01em;
	}

	p,
	ul {
		margin-top: 12px;
		color: var(--fg-muted);
	}

	ul {
		display: grid;
		gap: 10px;
		padding-left: 20px;
		list-style: disc;
	}

	a,
	main :global(a) {
		color: var(--fg);
		text-underline-offset: 3px;
		overflow-wrap: anywhere;
	}

	main :global(a.mono) {
		font-size: 13px;
	}
</style>
