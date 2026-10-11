<script lang="ts">
	import { resolve } from '$app/paths';
	import { COIN } from '#lib/arc.ts';
	import { shortAddress, timeLeft, usdc } from '#lib/format.ts';
	import { live } from '#lib/live.svelte.ts';
	import { dropState, type Drop } from '#lib/orbs.ts';

	let { drop }: { drop: Drop } = $props();

	let status = $derived(dropState(drop, live.now));
	let left = $derived(drop.prizes - drop.drawn);
</script>

<a
	class="card"
	class:over={status !== 'live'}
	href={resolve('/drop/[id]', { id: String(drop.id) })}
>
	<div class="top">
		<span class="badge {status}">
			{status === 'live' ? 'Live' : status === 'empty' ? 'All pulled' : 'Closed'}
		</span>
		<span class="mono id">#{drop.id}</span>
	</div>

	<p class="note">{drop.note || 'A lucky drop'}</p>

	<p class="pool">
		{usdc(drop.remaining)}
		<small>of {usdc(drop.pool)} {COIN}</small>
	</p>

	<div class="bar" aria-hidden="true">
		<i style:width="{(left / drop.prizes) * 100}%"></i>
	</div>

	<div class="meta">
		<span>{left} of {drop.prizes} {drop.prizes === 1 ? 'orb' : 'orbs'} left</span>
		<span>
			{#if status === 'live'}
				{timeLeft(drop.expiresAt, live.now)}
			{:else}
				by <span class="mono">{shortAddress(drop.creator)}</span>
			{/if}
		</span>
	</div>
</a>

<style>
	.card {
		display: grid;
		gap: 12px;
		padding: 18px;
		border: 1px solid var(--border);
		border-radius: 18px;
		background: linear-gradient(160deg, rgb(255 255 255 / 0.045), rgb(255 255 255 / 0.01));
		text-decoration: none;
		transition:
			border-color 0.15s,
			transform 0.15s;
	}

	.card:hover {
		border-color: var(--accent);
		transform: translateY(-2px);
	}

	.over {
		opacity: 0.62;
	}

	.top,
	.meta {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}

	.badge {
		padding: 3px 10px;
		border-radius: 999px;
		background: rgb(255 255 255 / 0.07);
		color: var(--fg-muted);
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}

	.badge.live {
		background: var(--accent-soft);
		color: var(--accent-strong);
	}

	.id {
		font-size: 12px;
		color: var(--fg-subtle);
	}

	.note {
		font-size: 17px;
		font-weight: 600;
		line-height: 1.3;
		overflow-wrap: anywhere;
	}

	.pool {
		font-size: 30px;
		font-weight: 800;
		letter-spacing: -0.03em;
		line-height: 1.1;
		font-variant-numeric: tabular-nums;
	}

	.pool small {
		font-size: 13px;
		font-weight: 500;
		letter-spacing: 0;
		color: var(--fg-muted);
	}

	.bar {
		height: 4px;
		border-radius: 2px;
		background: var(--border);
		overflow: hidden;
	}

	.bar i {
		display: block;
		height: 100%;
		border-radius: 2px;
		background: linear-gradient(90deg, var(--accent), var(--gold));
	}

	.meta {
		font-size: 13px;
		color: var(--fg-muted);
	}
</style>
