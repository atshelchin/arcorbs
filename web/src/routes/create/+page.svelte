<script lang="ts">
	import { parseUnits } from 'viem';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { arc, COIN, FAUCET } from '#lib/arc.ts';
	import { BRAND } from '#lib/brand.ts';
	import ExternalLink from '#lib/components/ExternalLink.svelte';
	import StageCanvas from '#lib/components/StageCanvas.svelte';
	import { usdc } from '#lib/format.ts';
	import { createDrop, describeError, MAX_NOTE_LENGTH, MIN_PRIZE } from '#lib/orbs.ts';
	import { sound } from '#lib/sound.svelte.ts';
	import type { Stage } from '#lib/stage/Stage.ts';
	import { wallet } from '#lib/wallet.svelte.ts';

	const DURATIONS = [
		{ label: '1 hour', seconds: 3600 },
		{ label: '6 hours', seconds: 6 * 3600 },
		{ label: '1 day', seconds: 86400 },
		{ label: '3 days', seconds: 3 * 86400 },
		{ label: '7 days', seconds: 7 * 86400 }
	];

	let amount = $state('10');
	let prizes = $state(20);
	let duration = $state(86400);
	let note = $state('');
	let busy = $state(false);
	/** The drop is on the chain; the page is about to show it. */
	let funded = $state(false);
	let failure = $state<string | null>(null);
	let stage = $state<Stage>();

	let pool = $derived.by(() => {
		try {
			return /^\d+(\.\d{1,18})?$/.test(amount.trim()) ? parseUnits(amount.trim(), 18) : null;
		} catch {
			return null;
		}
	});
	let count = $derived(
		Number.isInteger(prizes) && prizes >= 1 && prizes <= 4_000_000_000 ? prizes : null
	);
	let noteBytes = $derived(new TextEncoder().encode(note).length);

	let problem = $derived.by(() => {
		if (pool === null || pool === 0n) return `Enter how much ${COIN} to put in.`;
		if (count === null) return 'Enter how many orbs to fill.';
		if (pool < BigInt(count) * MIN_PRIZE)
			return `${count} orbs need at least ${usdc(BigInt(count) * MIN_PRIZE)} ${COIN}.`;
		if (noteBytes > MAX_NOTE_LENGTH) return 'That note is too long.';
		if (wallet.balance !== null && pool > wallet.balance) {
			return `This account holds ${usdc(wallet.balance)} ${COIN}.`;
		}
		return null;
	});

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (busy || problem || pool === null || count === null) return;
		busy = true;
		failure = null;
		sound.tap();
		try {
			const id = await createDrop({ pool, prizes: count, duration, note: note.trim() });
			// A beat to see and hear that it worked, before the page changes under it.
			funded = true;
			sound.success();
			stage?.celebrate();
			void wallet.refresh();
			await new Promise((resolve) => setTimeout(resolve, 1300));
			await goto(resolve('/drop/[id]', { id: String(id) }), { state: { funded: true } });
		} catch (error) {
			sound.fail();
			failure = describeError(error);
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head>
	<title>Fund a drop — {BRAND}</title>
</svelte:head>

<div class="page">
	<div class="scene">
		<StageCanvas prizes={count ?? 24} drawn={0} bind:stage />
	</div>

	<form class="panel" onsubmit={submit}>
		<div class="title">
			<p class="eyebrow">New drop</p>
			<h1>Fund a drop</h1>
			<p class="quiet">
				Your {COIN} fills a ring of orbs with random amounts. Each Vela account can pull one.
			</p>
			<p class="notice testnet">
				This is a game on {arc.name}. {COIN} is free and worth nothing.
				<ExternalLink href={FAUCET}>Get some from the faucet</ExternalLink>
			</p>
		</div>

		<label>
			<span>Pool</span>
			<div class="field">
				<input
					bind:value={amount}
					inputmode="decimal"
					autocomplete="off"
					aria-label="Pool in test USDC"
				/>
				<b>{COIN}</b>
			</div>
		</label>

		<label>
			<span>Orbs</span>
			<div class="field">
				<input bind:value={prizes} type="number" min="1" step="1" inputmode="numeric" />
				<b>pulls</b>
			</div>
		</label>

		<fieldset>
			<legend>Open for</legend>
			<div class="chips">
				{#each DURATIONS as option (option.seconds)}
					<label class="chip" class:on={duration === option.seconds}>
						<input type="radio" bind:group={duration} value={option.seconds} />
						{option.label}
					</label>
				{/each}
			</div>
		</fieldset>

		<label>
			<span>Note <small>optional</small></span>
			<div class="field">
				<input bind:value={note} placeholder="Welcome aboard" autocomplete="off" />
			</div>
		</label>

		{#if pool !== null && count !== null && !problem}
			<p class="summary">
				{count === 1 ? 'One account pulls' : `${count} accounts each pull`} an orb holding a random amount.
				An even share is <strong>{usdc(pool / BigInt(count))} {COIN}</strong>. Most orbs hold less
				than that, and now and then one holds several times as much. Whatever is left when the drop
				closes comes back to you.
			</p>
		{/if}

		{#if !wallet.account}
			<button
				type="button"
				class="button primary wide big"
				onclick={() => (wallet.pickerOpen = true)}
			>
				Connect Vela Wallet
			</button>
		{:else if wallet.standing === 'not-vela'}
			<p class="notice">
				This is not a Vela account, so it cannot fund a drop. {BRAND} only supports
				<a href="https://getvela.app" target="_blank" rel="noopener">Vela Wallet</a>.
			</p>
		{:else}
			<button
				class="button primary wide big"
				disabled={busy || problem !== null || wallet.standing === 'checking'}
			>
				{funded
					? 'Funded. Opening your drop…'
					: busy
						? 'Confirm in Vela…'
						: pool && !problem
							? `Fund ${usdc(pool)} ${COIN}`
							: 'Fund the drop'}
			</button>
			{#if problem}<p class="hint">{problem}</p>{/if}
			<p class="accept">
				A drop is a gift: it cannot be taken back before it closes. By funding one you accept the
				<a href={resolve('/terms')}>terms</a>.
			</p>
		{/if}
		{#if failure}
			<p class="error" role="alert">{failure}</p>
		{/if}
	</form>
</div>

<style>
	.page {
		display: grid;
		grid-template-columns: minmax(0, 1fr) min(440px, 42vw);
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
		gap: 20px;
		padding: calc(var(--header) + 16px) var(--gutter) 40px 28px;
		border-left: 1px solid var(--border);
		background: var(--bg);
	}

	.title {
		display: grid;
		gap: 8px;
	}

	h1 {
		font-size: clamp(28px, 3.6vw, 38px);
		font-weight: 800;
		letter-spacing: -0.03em;
		line-height: 1.1;
	}

	.quiet,
	.hint {
		font-size: 14px;
		color: var(--fg-muted);
	}

	.hint {
		text-align: center;
	}

	label,
	fieldset {
		display: grid;
		gap: 8px;
		min-width: 0;
		margin: 0;
		padding: 0;
		border: 0;
	}

	label > span,
	legend {
		padding: 0;
		font-size: 14px;
		font-weight: 600;
	}

	legend {
		margin-bottom: 8px;
	}

	small {
		font-weight: 400;
		color: var(--fg-subtle);
	}

	.field {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 0 16px;
		border: 1px solid var(--border-strong);
		border-radius: 14px;
		background: var(--bg-raised);
	}

	.field:focus-within {
		border-color: var(--accent);
	}

	.field input {
		flex: 1;
		min-width: 0;
		height: 54px;
		border: 0;
		outline: 0;
		background: none;
		font-size: 18px;
		font-weight: 600;
	}

	.field b {
		font-size: 13px;
		font-weight: 600;
		color: var(--fg-muted);
	}

	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}

	.chip {
		display: inline-flex;
		align-items: center;
		min-height: 40px;
		padding: 0 14px;
		border: 1px solid var(--border-strong);
		border-radius: 999px;
		font-size: 14px;
		font-weight: 600;
		cursor: pointer;
	}

	.chip input {
		position: absolute;
		opacity: 0;
		pointer-events: none;
	}

	.chip.on {
		border-color: var(--accent);
		background: var(--accent-soft);
		color: var(--accent-strong);
	}

	.chip:has(:focus-visible) {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}

	.summary {
		padding: 14px 16px;
		border-radius: 14px;
		background: var(--azure-soft);
		font-size: 14px;
		color: var(--fg-muted);
	}

	.summary strong {
		color: var(--fg);
	}

	.big {
		min-height: 60px;
		font-size: 18px;
		font-weight: 700;
	}

	.accept {
		font-size: 12px;
		text-align: center;
		color: var(--fg-subtle);
	}

	.accept a {
		color: var(--fg-muted);
	}

	.testnet {
		border-color: rgb(245 181 74 / 0.4);
		background: rgb(245 181 74 / 0.08);
	}

	.testnet :global(a) {
		color: var(--gold);
	}

	@media (max-width: 860px) {
		.page {
			grid-template-columns: minmax(0, 1fr);
		}

		.scene {
			position: relative;
			height: 34svh;
			min-height: 220px;
		}

		.panel {
			padding: 24px var(--gutter) calc(40px + env(safe-area-inset-bottom));
			border-left: 0;
			border-top: 1px solid var(--border);
		}
	}
</style>
