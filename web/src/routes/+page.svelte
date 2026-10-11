<script lang="ts">
	import { untrack } from 'svelte';
	import { resolve } from '$app/paths';
	import { arc, COIN, explorerAddress, FAUCET, orbsAddress } from '#lib/arc.ts';
	import { BRAND, SOURCE } from '#lib/brand.ts';
	import DropCard from '#lib/components/DropCard.svelte';
	import ExternalLink from '#lib/components/ExternalLink.svelte';
	import StageCanvas from '#lib/components/StageCanvas.svelte';
	import { live } from '#lib/live.svelte.ts';
	import { dropState, fetchDrops, mergeDrops, type Drop } from '#lib/orbs.ts';

	/** How many drops one read brings, and the most a refresh re-reads. */
	const PAGE = 24;
	const REFRESHED = 120;

	/** The drops read so far, newest first. Older ones are read on request. */
	let drops = $state<Drop[] | null>(null);
	/** How many drops there are in all. */
	let total = $state(0);
	let readingOlder = $state(false);
	let unreachable = $state(false);
	let older = $derived(drops?.at(-1)?.id ?? 0);

	// Open drops first; each group keeps the contract's order, newest first.
	let open = $derived((drops ?? []).filter((drop) => dropState(drop, live.now) === 'live'));
	let over = $derived((drops ?? []).filter((drop) => dropState(drop, live.now) !== 'live'));
	// The scene shows the newest open drop, or a stand-in when there is none.
	let shown = $derived(open[0] ?? { prizes: 24, drawn: 7 });

	// Reads the newest drops, and again every few seconds while the page is
	// open. A refresh re-reads what is on the page, up to a point: drops far
	// down the list are old, and old drops have stopped changing.
	$effect(() => {
		let stale = false;
		const load = () => {
			const onPage = untrack(() => drops?.length ?? 0);
			return fetchDrops(0, Math.min(Math.max(PAGE, onPage), REFRESHED)).then(
				(page) => {
					if (stale) return;
					drops = mergeDrops(untrack(() => drops) ?? [], page.drops);
					total = page.total;
					unreachable = false;
				},
				() => {
					if (!stale) unreachable = true;
				}
			);
		};
		void load();
		const interval = setInterval(() => !document.hidden && load(), 8000);
		return () => {
			stale = true;
			clearInterval(interval);
		};
	});

	/** Reads the page of drops below the oldest one shown. */
	async function readOlder() {
		if (!drops || readingOlder || older === 0) return;
		readingOlder = true;
		try {
			// Counted back from the newest drop; if more were funded since, the
			// page overlaps what is shown, and the merge keeps one of each.
			const page = await fetchDrops(total - older, PAGE);
			drops = mergeDrops(drops, page.drops);
			total = page.total;
		} catch {
			// The list keeps what it has; the button asks again.
		} finally {
			readingOlder = false;
		}
	}
</script>

<svelte:head>
	<title>{BRAND} — a game of orbs on Arc Testnet, for Vela Wallet</title>
</svelte:head>

<section class="hero">
	<div class="backdrop">
		<StageCanvas prizes={shown.prizes} drawn={shown.drawn} shift={0.3} hud="right" />
	</div>
	<div class="copy">
		<p class="eyebrow">A game on {arc.name} <span>·</span> Only for Vela Wallet</p>
		<h1>Pull an orb.<br />See what it holds.</h1>
		<p class="lede">
			Every drop is a ring of orbs filled with {COIN}. Each Vela account gets one pull. It is a
			game:
			{COIN} is free and worth nothing.
		</p>
		<div class="actions">
			<a class="button primary" href={resolve('/create')}>Fund a drop</a>
			<a class="button" href="#drops">See the drops</a>
		</div>
	</div>
</section>

<main>
	<section id="drops">
		<div class="heading">
			<h2>Drops</h2>
			{#if total > 0}<span class="count">{total}</span>{/if}
		</div>

		<p class="notice testnet">
			You need a little {COIN} to play, and it is free.
			<ExternalLink href={FAUCET}>Get some from the faucet</ExternalLink>
		</p>

		{#if drops === null}
			<p class="empty">
				{unreachable
					? `${arc.name} is not answering. Trying again…`
					: `Reading the drops from ${arc.name}…`}
			</p>
		{:else if drops.length === 0}
			<div class="empty">
				<p>Nobody has funded a drop yet.</p>
				<a class="button primary" href={resolve('/create')}>Fund the first one</a>
			</div>
		{:else}
			<div class="grid">
				{#each [...open, ...over] as drop (drop.id)}
					<DropCard {drop} />
				{/each}
			</div>
			{#if older > 0}
				<button class="button more" disabled={readingOlder} onclick={readOlder}>
					{readingOlder ? 'Reading…' : `Show older drops (${older} more)`}
				</button>
			{/if}
		{/if}
	</section>

	<section class="how">
		<h2>How it works</h2>
		<ol>
			<li>
				<span class="step">1</span>
				<h3>Someone funds a drop</h3>
				<p>
					They put {COIN} in and choose how many orbs it fills, and how long the drop stays open.
				</p>
			</li>
			<li>
				<span class="step">2</span>
				<h3>You pull one orb</h3>
				<p>
					One pull per Vela account, per drop. Every orb holds something, and a few hold several
					times an even share.
				</p>
			</li>
			<li>
				<span class="step">3</span>
				<h3>It is already yours</h3>
				<p>
					The contract pays your wallet in the same transaction as the pull. There is nothing to
					claim.
				</p>
			</li>
		</ol>
	</section>
</main>

<footer>
	<p>
		{BRAND} is a small game for
		<a href="https://getvela.app" target="_blank" rel="noopener">Vela Wallet</a>, played on {arc.name}
		with {COIN}, which is free and worth nothing.
	</p>
	<nav aria-label="About">
		<a href={resolve('/terms')}>Terms</a>
		<ExternalLink href={SOURCE}>Source</ExternalLink>
		<ExternalLink href={explorerAddress(orbsAddress)}>Contract</ExternalLink>
	</nav>
</footer>

<style>
	.hero {
		position: relative;
		display: flex;
		align-items: flex-end;
		min-height: min(100svh, 860px);
		/* The copy lines up with the sections below it. */
		padding: calc(var(--header) + 24px)
			max(var(--gutter), calc((100vw - 1160px) / 2 + var(--gutter))) clamp(40px, 8vh, 80px);
		overflow: hidden;
	}

	.backdrop {
		position: absolute;
		inset: 0;
	}

	/* The scene dims behind the copy and fades into the page below it. */
	.hero::after {
		content: '';
		position: absolute;
		inset: 0;
		background:
			linear-gradient(180deg, transparent 78%, var(--bg)),
			radial-gradient(ellipse 75% 80% at 0% 100%, rgb(13 12 11 / 0.88) 30%, transparent 72%);
		pointer-events: none;
	}

	.copy {
		position: relative;
		z-index: 1;
		display: grid;
		gap: 18px;
		max-width: 620px;
	}

	.eyebrow span {
		margin: 0 4px;
		color: var(--accent);
	}

	h1 {
		font-size: clamp(40px, 8vw, 76px);
		font-weight: 800;
		line-height: 1;
		letter-spacing: -0.04em;
	}

	.lede {
		max-width: 520px;
		font-size: clamp(16px, 2vw, 19px);
		color: var(--fg-muted);
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 12px;
		margin-top: 6px;
	}

	main {
		display: grid;
		gap: clamp(56px, 9vw, 96px);
		max-width: 1160px;
		margin: 0 auto;
		padding: clamp(32px, 6vw, 64px) var(--gutter);
	}

	.heading {
		display: flex;
		align-items: baseline;
		gap: 12px;
		margin-bottom: 20px;
	}

	h2 {
		font-size: clamp(24px, 4vw, 32px);
		font-weight: 800;
		letter-spacing: -0.03em;
	}

	.count {
		font-size: 16px;
		font-weight: 600;
		color: var(--fg-muted);
	}

	.more {
		display: flex;
		margin: 24px auto 0;
	}

	.testnet {
		margin-bottom: 20px;
		border-color: rgb(245 181 74 / 0.4);
		background: rgb(245 181 74 / 0.08);
	}

	.testnet :global(a) {
		color: var(--gold);
	}

	footer nav {
		display: flex;
		gap: 16px;
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 290px), 1fr));
		gap: 16px;
	}

	.empty {
		display: grid;
		justify-items: start;
		gap: 16px;
		padding: 28px;
		border: 1px dashed var(--border-strong);
		border-radius: 18px;
		color: var(--fg-muted);
	}

	.how h2 {
		margin-bottom: 20px;
	}

	ol {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 250px), 1fr));
		gap: 16px;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	li {
		display: grid;
		align-content: start;
		gap: 8px;
		padding: 22px;
		border: 1px solid var(--border);
		border-radius: 18px;
	}

	.step {
		display: grid;
		place-items: center;
		width: 32px;
		height: 32px;
		border-radius: 50%;
		background: var(--azure-soft);
		color: var(--azure);
		font-weight: 700;
	}

	h3 {
		font-size: 18px;
		font-weight: 700;
	}

	li p {
		font-size: 15px;
		color: var(--fg-muted);
	}

	footer {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		gap: 12px;
		max-width: 1160px;
		margin: 0 auto;
		padding: 28px var(--gutter) calc(40px + env(safe-area-inset-bottom));
		border-top: 1px solid var(--border);
		font-size: 13px;
		color: var(--fg-subtle);
	}

	/* A phone has no room beside the scene: it takes the top, the copy the bottom. */
	@media (max-width: 760px) {
		.hero {
			min-height: 100svh;
			padding-bottom: calc(28px + env(safe-area-inset-bottom));
		}

		.backdrop {
			bottom: 36%;
		}

		.hero::after {
			background: linear-gradient(180deg, transparent 44%, var(--bg) 64%);
		}

		.actions .button {
			flex: 1;
		}
	}
</style>
