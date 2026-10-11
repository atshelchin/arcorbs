<script lang="ts">
	import '@fontsource-variable/plus-jakarta-sans';
	import '@fontsource/ibm-plex-mono/400.css';
	import '@fontsource/ibm-plex-mono/500.css';
	import '../app.css';
	import { onMount } from 'svelte';
	import { dev } from '$app/env';
	import { page } from '$app/state';
	import favicon from '#lib/assets/favicon.svg';
	import { BRAND, MAKER_ON_X } from '#lib/brand.ts';
	import ConnectModal from '#lib/components/ConnectModal.svelte';
	import Header from '#lib/components/Header.svelte';
	import { startLive } from '#lib/live.svelte.ts';
	import { sound } from '#lib/sound.svelte.ts';
	import { wallet } from '#lib/wallet.svelte.ts';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();

	// What a link to this page shows when it is shared. A page that knows
	// better — a drop — returns its own from `load`.
	let card = $derived(
		(page.data.card as { title: string; description: string; image: string } | undefined) ?? {
			title: `${BRAND} — a game of orbs on Arc Testnet`,
			description:
				'Pull an orb and see what it holds. A game for Vela Wallet, played with test USDC, which is free and worth nothing.',
			image: '/card.png'
		}
	);

	onMount(() => {
		wallet.discover();
		// Audio may only start once the page has been touched, and takes a moment to.
		addEventListener('pointerdown', () => sound.wake(), { once: true });
		return startLive();
	});
</script>

<svelte:head>
	<meta name="description" content={card.description} />
	<meta property="og:type" content="website" />
	<meta property="og:site_name" content={BRAND} />
	<meta property="og:title" content={card.title} />
	<meta property="og:description" content={card.description} />
	<meta property="og:url" content={page.url.href} />
	<meta property="og:image" content="{page.url.origin}{card.image}" />
	<meta property="og:image:width" content="1200" />
	<meta property="og:image:height" content="630" />
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:site" content={MAKER_ON_X} />
	<link rel="icon" href={favicon} />
	<!-- Counts visits. Left out of development, so a local run is not counted as one. -->
	{#if !dev}
		<script src="https://tj.appsdata.org/api/script.js" data-site-id="765b6fb7e95e" defer></script>
	{/if}
</svelte:head>

<Header />
{@render children()}
<ConnectModal />
