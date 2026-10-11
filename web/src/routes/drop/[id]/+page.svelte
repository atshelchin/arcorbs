<script lang="ts">
	import { cubicOut } from 'svelte/easing';
	import { Tween } from 'svelte/motion';
	import type { Hex } from 'viem';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { arc, COIN, explorerTx, FAUCET } from '#lib/arc.ts';
	import { BRAND, VELA_ON_X } from '#lib/brand.ts';
	import ExternalLink from '#lib/components/ExternalLink.svelte';
	import ShareButtons from '#lib/components/ShareButtons.svelte';
	import StageCanvas from '#lib/components/StageCanvas.svelte';
	import { shortAddress, timeLeft, usdc, usdcPrize } from '#lib/format.ts';
	import { live } from '#lib/live.svelte.ts';
	import {
		describeError,
		draw,
		dropState,
		fetchPrize,
		fetchPulls,
		findPull,
		mergePulls,
		prizeTier,
		refund,
		type Drop,
		type Pull,
		type Tier
	} from '#lib/orbs.ts';
	import { postOnX } from '#lib/share.ts';
	import { sound } from '#lib/sound.svelte.ts';
	import type { Stage } from '#lib/stage/Stage.ts';
	import { wallet } from '#lib/wallet.svelte.ts';

	const TIERS = ['Pocket change', 'Nice pull', 'Big catch', 'Jackpot'] as const;

	let id = $derived(/^\d{1,9}$/.test(page.params.id ?? '') ? Number(page.params.id) : null);

	let drop = $state<Drop | null>(null);
	/** The pulls read so far, newest first. Older ones are read as the list is scrolled. */
	let pulls = $state<Pull[]>([]);
	let readingOlder = $state(false);
	let missing = $state(false);
	/** What the connected account pulled from this drop, once known. */
	let prize = $state<bigint | null>(null);

	let stage = $state<Stage>();
	let busy = $state<'signing' | 'landing' | 'refunding' | null>(null);
	let failure = $state<string | null>(null);
	/** The pull made on this visit, shown over the scene. */
	let won = $state<{ amount: bigint; tier: Tier; transaction?: Hex } | null>(null);
	const counted = new Tween(0, { duration: 1100, easing: cubicOut });
	/** Arrived here straight from funding this drop: the page says so, once. */
	let launched = $state(page.state.funded === true);
	/** Set while a pull is under way: nothing read from the chain is shown until the orb breaks. */
	let holding = false;

	let status = $derived(drop ? dropState(drop, live.now) : null);
	let left = $derived(drop ? drop.prizes - drop.drawn : 0);
	let mine = $derived(drop !== null && wallet.account === drop.creator);
	let pulled = $derived(prize !== null && prize > 0n);

	/**
	 * The link a share carries. An account that pulled shares its own pull:
	 * the card that link unfolds into shows what it won.
	 */
	let shareUrl = $derived(
		`${page.url.origin}${page.url.pathname}${pulled && wallet.account ? `?by=${wallet.account}` : ''}`
	);

	/** What whoever funded this drop says to announce it. */
	let announcement = $derived(
		drop
			? `I filled ${drop.prizes} Arc ${drop.prizes === 1 ? 'Orb' : 'Orbs'} with ${usdc(drop.pool)} ${COIN}. A game on ${arc.name}, only for ${VELA_ON_X}. Pull one:`
			: ''
	);

	/** The post a share starts from: what this account did here, or what is on offer. */
	let shareText = $derived.by(() => {
		const closing = `A game on ${arc.name}, only for ${VELA_ON_X}.`;
		if (prize !== null && prize > 0n) {
			return `I just pulled an Arc Orb: ${usdcPrize(prize)} ${COIN}. ${closing} Pull yours:`;
		}
		if (drop && mine) return announcement;
		if (drop && status === 'live') {
			return `${left} Arc ${left === 1 ? 'Orb is' : 'Orbs are'} waiting to be pulled, with ${usdc(drop.remaining)} ${COIN} inside. ${closing} Pull one:`;
		}
		return `${BRAND}: pull an orb, see what it holds. ${closing}`;
	});

	async function load() {
		if (id === null) return;
		const account = wallet.account;
		const wanted = id;
		try {
			const [latest, nextPrize] = await Promise.all([
				fetchPulls(id),
				account ? fetchPrize(id, account) : null
			]);
			// The chain knows a pull's result before the orb has broken. The page
			// keeps what it showed until then, so the scene is the first to tell.
			if (wanted !== id || holding) return;
			drop = latest.drop;
			pulls = mergePulls(pulls, latest.pulls);
			if (account === wallet.account) prize = nextPrize;
		} catch (error) {
			if (describeError(error) === 'This drop does not exist.') missing = true;
		}
	}

	/** Reads the next hundred pulls below the oldest one shown. */
	async function readOlder() {
		const oldest = pulls.at(-1)?.index ?? 0;
		if (id === null || !drop || readingOlder || holding || oldest === 0) return;
		readingOlder = true;
		const wanted = id;
		try {
			// Counted back from the latest pull; if more have landed since, the
			// page overlaps what is shown, and the merge drops the repeats.
			const older = await fetchPulls(wanted, drop.drawn - oldest, 100);
			if (wanted === id && !holding) pulls = mergePulls(pulls, older.pulls);
		} catch {
			// The list keeps what it has; scrolling to its end asks again.
		} finally {
			readingOlder = false;
		}
	}

	/** Reads older pulls when the end of the list scrolls into view. */
	function whenSeen(node: HTMLElement) {
		const observer = new IntersectionObserver(([entry]) => entry.isIntersecting && readOlder(), {
			rootMargin: '300px'
		});
		observer.observe(node);
		return () => observer.disconnect();
	}

	// The scene joins in as soon as it is there.
	$effect(() => {
		if (launched && stage) stage.celebrate();
	});

	// A different drop starts the page again.
	$effect(() => {
		void id;
		drop = null;
		pulls = [];
		missing = false;
		won = null;
	});

	// Reads the drop whenever it or the account changes, and
	// again every few seconds while the page is open.
	$effect(() => {
		void [id, wallet.account];
		prize = null;
		void load();
		const interval = setInterval(() => !document.hidden && load(), 3000);
		return () => clearInterval(interval);
	});

	async function pull() {
		if (!drop || busy) return;
		busy = 'signing';
		holding = true;
		launched = false;
		failure = null;
		// On a phone the button sits under the scene; bring the scene back into view.
		scrollTo({ top: 0, behavior: 'smooth' });
		sound.tap();
		sound.charge();
		stage?.charge();
		try {
			const outcome = await draw(drop.id, () => (busy = 'landing'));
			const tier = prizeTier(outcome.amount, drop);
			sound.fly(stage?.flightSeconds ?? 0);
			await stage?.reveal(tier);
			sound.burst(tier);
			navigator.vibrate?.(tier >= 2 ? [30, 50, 30, 50, 140] : 50);
			won = { ...outcome, tier };
			prize = outcome.amount;
			counted.set(0, { duration: 0 });
			void counted.set(1);
			if (!outcome.transaction && wallet.account) {
				// The chain confirmed before the wallet did; ask it where the pull landed.
				void findPull(drop.id, wallet.account).then(
					(transaction) => {
						if (won && transaction) won = { ...won, transaction };
					},
					() => {}
				);
			}
		} catch (error) {
			stage?.settle();
			sound.fail();
			failure = describeError(error);
		} finally {
			busy = null;
			holding = false;
			void load();
			void wallet.refresh();
		}
	}

	async function takeBack() {
		if (!drop || busy) return;
		busy = 'refunding';
		failure = null;
		try {
			await refund(drop.id);
		} catch (error) {
			failure = describeError(error);
		} finally {
			busy = null;
			void load();
			void wallet.refresh();
		}
	}
</script>

<svelte:head>
	<title>{drop?.note || (id !== null ? `Drop #${id}` : 'Drop')} — {BRAND}</title>
</svelte:head>

<div class="page">
	<div class="scene">
		<StageCanvas prizes={drop?.prizes ?? 24} drawn={drop?.drawn ?? 0} bind:stage />

		{#if launched && drop && !won}
			<div class="won" role="status">
				<p class="tier live">Your drop is live</p>
				<p class="amount">{usdc(drop.pool)}</p>
				<p class="paid">
					{COIN} in {drop.prizes}
					{drop.prizes === 1 ? 'orb' : 'orbs'}, open for {timeLeft(drop.expiresAt, live.now)}
				</p>
				<p class="next">Nobody can pull an orb they have not heard of. Send the link.</p>
				<div class="live-actions">
					<ShareButtons text={announcement} url={page.url.origin + page.url.pathname} />
					<button class="button" onclick={() => (launched = false)}>Close</button>
				</div>
			</div>
		{/if}

		{#if won}
			<div class="won tier-{won.tier}" role="status">
				<p class="tier">{TIERS[won.tier]}</p>
				<p class="amount">
					{usdcPrize((won.amount * BigInt(Math.round(counted.current * 1e6))) / 1_000_000n)}
				</p>
				<p class="paid">{COIN}, paid to your wallet</p>
				<div class="won-actions">
					<ExternalLink class="button primary" href={postOnX(shareText, shareUrl)}>
						Share on X
					</ExternalLink>
					{#if won.transaction}
						<ExternalLink class="button" href={explorerTx(won.transaction)}>
							View on Arc
						</ExternalLink>
					{/if}
					<button class="button" onclick={() => (won = null)}>Close</button>
				</div>
			</div>
		{/if}
	</div>

	<aside class="panel">
		{#if id === null || missing}
			<h1>No such drop</h1>
			<p class="quiet">This link does not point at a drop.</p>
			<a class="button" href={resolve('/')}> See the drops </a>
		{:else if !drop}
			<p class="quiet">Reading the drop from {arc.name}…</p>
		{:else}
			<div class="title">
				<p class="eyebrow">
					Drop #{drop.id} <span>·</span> by <span class="mono">{shortAddress(drop.creator)}</span>
				</p>
				<h1>{drop.note || 'A lucky drop'}</h1>
				{#if !pulled}
					<ShareButtons text={shareText} url={shareUrl} compact />
				{/if}
			</div>

			<dl class="stats">
				<div>
					<dt>Left in the pool</dt>
					<dd>{usdc(drop.remaining)} <small>of {usdc(drop.pool)} {COIN}</small></dd>
				</div>
				<div>
					<dt>Orbs left</dt>
					<dd>{left} <small>of {drop.prizes}</small></dd>
				</div>
				<div>
					<dt>{status === 'live' ? 'Closes in' : 'Status'}</dt>
					<dd>
						{status === 'live'
							? timeLeft(drop.expiresAt, live.now)
							: status === 'empty'
								? 'All pulled'
								: 'Closed'}
					</dd>
				</div>
			</dl>

			<div class="action">
				{#if prize !== null && prize > 0n}
					<div class="drew">
						<p>You pulled</p>
						<p class="drew-amount">{usdcPrize(prize)} <small>{COIN}</small></p>
					</div>
					<ShareButtons text={shareText} url={shareUrl} />
				{:else if status === 'empty'}
					<p class="quiet">Every orb in this drop has been pulled.</p>
				{:else if status === 'closed'}
					<p class="quiet">This drop has closed.</p>
				{:else if !wallet.account}
					<button class="button primary wide big" onclick={() => (wallet.pickerOpen = true)}>
						Connect Vela Wallet to pull
					</button>
				{:else if wallet.standing === 'checking' || prize === null}
					<button class="button wide big" disabled>Checking your account…</button>
				{:else if wallet.standing === 'not-vela'}
					<p class="notice">
						This is not a Vela account, so it cannot pull. {BRAND} only supports
						<a href="https://getvela.app" target="_blank" rel="noopener">Vela Wallet</a>.
					</p>
				{:else}
					<button class="button primary wide big" disabled={busy !== null} onclick={pull}>
						{busy === 'signing'
							? 'Confirm in Vela…'
							: busy === 'landing'
								? `Waiting for ${arc.name}…`
								: 'Pull an orb'}
					</button>
					{#if wallet.balance === 0n}
						<p class="hint">
							This account has no {COIN} yet, and a pull costs a small network fee in it.
							<ExternalLink href={FAUCET}>Get some from the faucet</ExternalLink>
						</p>
					{:else if wallet.standing === 'new-vela'}
						<p class="hint">
							Your first transaction on {arc.name}. This pull also sets your account up.
						</p>
					{:else}
						<p class="hint">One pull per Vela account. {COIN} is free and worth nothing.</p>
					{/if}
					<p class="accept">
						By pulling you accept the <a href={resolve('/terms')}>terms</a>.
					</p>
				{/if}

				{#if mine && status === 'closed' && drop.remaining > 0n}
					<button class="button wide" disabled={busy !== null} onclick={takeBack}>
						{busy === 'refunding' ? 'Refunding…' : `Refund ${usdc(drop.remaining)} ${COIN}`}
					</button>
				{/if}
				{#if failure}
					<p class="error" role="alert">{failure}</p>
				{/if}
			</div>

			<section class="draws">
				<h2>Pulls <small>{drop.drawn}</small></h2>
				{#if pulls.length === 0}
					<p class="quiet">Nobody has pulled yet. The first orb is yours.</p>
				{:else}
					<ul>
						{#each pulls as entry (entry.index)}
							<li class:you={entry.player === wallet.account}>
								<span class="mono who">
									{shortAddress(entry.player)}
									{#if entry.player === wallet.account}<em>you</em>{/if}
								</span>
								{#if entry.player === drop.luckiest}
									<span class="best">Luckiest</span>
								{/if}
								<span class="got">{usdcPrize(entry.amount)}</span>
							</li>
						{/each}
					</ul>
					{#if pulls[pulls.length - 1].index > 0}
						<button
							class="button older"
							disabled={readingOlder}
							onclick={readOlder}
							{@attach whenSeen}
						>
							{readingOlder
								? 'Reading…'
								: `Show older pulls (${pulls[pulls.length - 1].index} more)`}
						</button>
					{/if}
				{/if}
			</section>
		{/if}
	</aside>
</div>

<style>
	.page {
		display: grid;
		grid-template-columns: minmax(0, 1fr) min(420px, 38vw);
		min-height: 100svh;
	}

	.scene {
		position: sticky;
		top: 0;
		height: 100svh;
		overflow: hidden;
	}

	.panel {
		display: grid;
		align-content: start;
		gap: 24px;
		padding: calc(var(--header) + 16px) var(--gutter) 40px 28px;
		border-left: 1px solid var(--border);
		background: var(--bg);
	}

	.title {
		display: grid;
		gap: 10px;
	}

	.eyebrow > span:not(.mono) {
		margin: 0 4px;
		color: var(--accent);
	}

	.eyebrow .mono {
		letter-spacing: 0;
		text-transform: none;
	}

	h1 {
		font-size: clamp(26px, 3.4vw, 36px);
		font-weight: 800;
		line-height: 1.1;
		letter-spacing: -0.03em;
		overflow-wrap: anywhere;
	}

	.stats {
		display: grid;
		gap: 1px;
		border: 1px solid var(--border);
		border-radius: 16px;
		background: var(--border);
		overflow: hidden;
	}

	.stats div {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 12px;
		padding: 13px 16px;
		background: var(--bg-raised);
	}

	dt {
		font-size: 14px;
		color: var(--fg-muted);
	}

	dd {
		font-size: 18px;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}

	small {
		font-size: 13px;
		font-weight: 500;
		color: var(--fg-muted);
	}

	.action {
		display: grid;
		gap: 12px;
	}

	.big {
		min-height: 60px;
		font-size: 19px;
		font-weight: 700;
	}

	.hint,
	.quiet {
		font-size: 14px;
		color: var(--fg-muted);
	}

	.hint {
		text-align: center;
	}

	.accept {
		font-size: 12px;
		text-align: center;
		color: var(--fg-subtle);
	}

	.accept a {
		color: var(--fg-muted);
	}

	.hint :global(a) {
		color: var(--gold);
		font-weight: 600;
	}

	.drew {
		padding: 18px;
		border: 1px solid rgb(245 181 74 / 0.4);
		border-radius: 16px;
		background: rgb(245 181 74 / 0.08);
		text-align: center;
		color: var(--fg-muted);
	}

	.drew-amount {
		font-size: 38px;
		font-weight: 800;
		letter-spacing: -0.03em;
		line-height: 1.15;
		color: var(--gold);
	}

	/* The amount is set tight; at this size that would close up "test USDC". */
	.drew-amount small {
		letter-spacing: 0;
	}

	.draws {
		display: grid;
		gap: 12px;
	}

	h2 {
		font-size: 18px;
		font-weight: 700;
	}

	.draws ul {
		display: grid;
		gap: 2px;
	}

	.older {
		min-height: 40px;
		font-size: 14px;
	}

	.draws li {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 10px 12px;
		border-radius: 10px;
		font-size: 14px;
	}

	.draws li:nth-child(odd) {
		background: rgb(255 255 255 / 0.03);
	}

	.draws li.you {
		background: var(--accent-soft);
	}

	.who {
		flex: 1;
		color: var(--fg-muted);
	}

	.who em {
		margin-left: 6px;
		font-family: var(--font);
		font-style: normal;
		font-weight: 600;
		color: var(--accent-strong);
	}

	.best {
		padding: 2px 8px;
		border-radius: 999px;
		background: rgb(245 181 74 / 0.14);
		color: var(--gold);
		font-size: 11px;
		font-weight: 700;
	}

	.got {
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}

	.won {
		position: absolute;
		inset: 0;
		z-index: 4;
		display: grid;
		place-content: center;
		justify-items: center;
		gap: 4px;
		padding: 24px;
		background: radial-gradient(
			ellipse at center,
			rgb(13 12 11 / 0.84),
			rgb(13 12 11 / 0.55) 45%,
			transparent 78%
		);
		text-align: center;
		animation: arrive 0.5s cubic-bezier(0.2, 1.4, 0.4, 1) both;
	}

	@keyframes arrive {
		from {
			opacity: 0;
			transform: scale(0.7);
		}
	}

	.tier {
		font-size: clamp(15px, 2.2vw, 20px);
		font-weight: 800;
		letter-spacing: 0.2em;
		text-transform: uppercase;
		color: var(--fg-muted);
	}

	.tier.live {
		color: var(--success);
	}

	.next {
		max-width: 320px;
		margin-top: 10px;
		font-size: 15px;
		color: var(--fg);
	}

	.live-actions {
		display: grid;
		gap: 10px;
		width: min(100%, 340px);
		margin-top: 20px;
	}

	.live-actions > .button {
		background: rgb(13 12 11 / 0.7);
		backdrop-filter: blur(8px);
	}

	.tier-2 .tier {
		color: var(--accent-strong);
	}

	.tier-3 .tier {
		color: var(--gold);
	}

	.amount {
		font-size: clamp(56px, 13vw, 128px);
		font-weight: 800;
		letter-spacing: -0.05em;
		line-height: 1;
		font-variant-numeric: tabular-nums;
		background: linear-gradient(180deg, #fff6e6, var(--gold) 70%, var(--accent));
		-webkit-background-clip: text;
		background-clip: text;
		color: transparent;
		filter: drop-shadow(0 8px 40px rgb(245 181 74 / 0.45));
	}

	.paid {
		color: var(--fg-muted);
	}

	.won-actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 10px;
		margin-top: 22px;
	}

	.won-actions :global(.button:not(.primary)) {
		background: rgb(13 12 11 / 0.7);
		backdrop-filter: blur(8px);
	}

	/* A phone: the scene on top, the drop under it, and the one thing to do
	   pinned where the thumb is. */
	@media (max-width: 860px) {
		.page {
			grid-template-columns: minmax(0, 1fr);
		}

		.scene {
			position: relative;
			height: 54svh;
			min-height: 320px;
		}

		.panel {
			gap: 20px;
			padding: 22px var(--gutter) calc(170px + env(safe-area-inset-bottom));
			border-left: 0;
			border-top: 1px solid var(--border);
		}

		.stats {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}

		.stats div {
			flex-direction: column;
			align-items: flex-start;
			gap: 2px;
			padding: 12px;
		}

		dt {
			font-size: 12px;
		}

		dd {
			font-size: 16px;
		}

		dd small {
			display: block;
			font-size: 11px;
		}

		.action {
			position: fixed;
			z-index: 6;
			left: 0;
			right: 0;
			bottom: 0;
			padding: 30px var(--gutter) calc(14px + env(safe-area-inset-bottom));
			background: linear-gradient(180deg, transparent, var(--bg) 30px);
		}

		.drew {
			display: flex;
			align-items: center;
			justify-content: space-between;
			padding: 12px 16px;
		}

		.drew-amount {
			font-size: 26px;
		}

		.won-actions {
			margin-top: 14px;
		}

		/* The bar pinned under the scene already offers the share. */
		.won-actions :global(.primary) {
			display: none;
		}
	}
</style>
