<script lang="ts">
	import { resolve } from '$app/paths';
	import { BRAND } from '#lib/brand.ts';
	import SoundToggle from './SoundToggle.svelte';
	import WalletButton from './WalletButton.svelte';
</script>

<header>
	<a class="brand" href={resolve('/')} aria-label="{BRAND}, home">
		<svg viewBox="0 0 64 64" width="28" height="28" aria-hidden="true">
			<path
				d="M10 42a22 22 0 0 1 44 0"
				fill="none"
				stroke="var(--accent)"
				stroke-width="6"
				stroke-linecap="round"
			/>
			<circle cx="32" cy="42" r="8" fill="var(--azure)" />
		</svg>
		<span><em>Arc</em> Orbs</span>
	</a>
	<span class="testnet" title="Played with test USDC, which is free and worth nothing">Testnet</span
	>
	<SoundToggle />
	<WalletButton />
</header>

<style>
	header {
		position: absolute;
		z-index: 10;
		top: env(safe-area-inset-top);
		left: 0;
		right: 0;
		display: flex;
		align-items: center;
		gap: 12px;
		height: var(--header);
		padding: 0 var(--gutter);
	}

	.brand {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		font-size: 20px;
		font-weight: 800;
		letter-spacing: -0.02em;
		text-decoration: none;
		white-space: nowrap;
	}

	em {
		font-style: normal;
		color: var(--azure);
	}

	/* Said once, next to the name, on every page: none of this is real money. */
	.testnet {
		margin-right: auto;
		padding: 3px 10px;
		border-radius: 999px;
		background: rgb(245 181 74 / 0.14);
		color: var(--gold);
		font-size: 12px;
		font-weight: 700;
		letter-spacing: 0.04em;
	}
</style>
