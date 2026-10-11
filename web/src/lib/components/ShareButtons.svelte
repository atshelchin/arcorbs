<script lang="ts">
	import { copyText, postOnX } from '#lib/share.ts';
	import ExternalLink from './ExternalLink.svelte';

	let { text, url, compact = false }: { text: string; url: string; compact?: boolean } = $props();

	let copied = $state(false);

	async function copy() {
		await copyText(url);
		copied = true;
		setTimeout(() => (copied = false), 2000);
	}
</script>

<div class="share" class:compact>
	<ExternalLink href={postOnX(text, url)} class={compact ? 'button' : 'button primary'}>
		<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
			<path
				fill="currentColor"
				d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"
			/>
		</svg>
		Share on X
	</ExternalLink>
	<button class="button" onclick={copy}>{copied ? 'Copied' : 'Copy link'}</button>
</div>

<style>
	.share {
		display: flex;
		gap: 10px;
	}

	.share :global(.button) {
		flex: 1;
		white-space: nowrap;
	}

	.compact :global(.button) {
		flex: none;
		min-height: 40px;
		padding: 0 16px;
		font-size: 14px;
	}
</style>
