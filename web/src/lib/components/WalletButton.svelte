<script lang="ts">
	import { shortAddress } from '#lib/format.ts';
	import { wallet } from '#lib/wallet.svelte.ts';
</script>

{#if wallet.account}
	<button class="account" onclick={() => (wallet.pickerOpen = true)}>
		{#if wallet.current?.icon}
			<img src={wallet.current.icon} alt="" width="20" height="20" />
		{/if}
		<span class="mono address">{shortAddress(wallet.account)}</span>
		{#if wallet.canPlay}
			<span class="tag vela">Vela</span>
		{:else if wallet.standing === 'not-vela'}
			<span class="tag">View only</span>
		{/if}
	</button>
{:else}
	<button class="button connect" onclick={() => (wallet.pickerOpen = true)}>Connect</button>
{/if}

<style>
	.account {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		min-height: 40px;
		padding: 0 12px 0 10px;
		border: 1px solid var(--border-strong);
		border-radius: 999px;
		background: rgb(13 12 11 / 0.6);
		backdrop-filter: blur(10px);
		font-size: 13px;
		cursor: pointer;
	}

	.account:hover {
		border-color: var(--fg-subtle);
	}

	img {
		border-radius: 6px;
	}

	.tag {
		padding: 2px 8px;
		border-radius: 999px;
		background: rgb(255 255 255 / 0.08);
		color: var(--fg-muted);
		font-size: 11px;
		font-weight: 600;
		white-space: nowrap;
	}

	.tag.vela {
		background: var(--accent-soft);
		color: var(--accent-strong);
	}

	/* On a phone the tag says enough; the address is one tap away. */
	@media (max-width: 420px) {
		.address {
			display: none;
		}
	}

	.connect {
		min-height: 40px;
		padding: 0 18px;
		font-size: 14px;
		background: rgb(13 12 11 / 0.6);
		backdrop-filter: blur(10px);
	}
</style>
