<script lang="ts">
	import { sound } from '#lib/sound.svelte.ts';
</script>

<button
	onclick={() => sound.toggle()}
	aria-pressed={!sound.muted}
	aria-label={sound.muted ? 'Turn sound on' : 'Turn sound off'}
	title={sound.muted ? 'Sound is off' : 'Sound is on'}
>
	<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
		<path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z" fill="currentColor" />
		{#if sound.muted}
			<path
				d="M16 9.5l5 5m0-5l-5 5"
				fill="none"
				stroke="currentColor"
				stroke-width="1.8"
				stroke-linecap="round"
			/>
		{:else}
			<path
				d="M15.5 9a4.2 4.2 0 0 1 0 6m2.6-8.6a8 8 0 0 1 0 11.2"
				fill="none"
				stroke="currentColor"
				stroke-width="1.8"
				stroke-linecap="round"
			/>
		{/if}
	</svg>
</button>

<style>
	button {
		display: grid;
		place-items: center;
		flex: none;
		width: 40px;
		height: 40px;
		border: 1px solid var(--border-strong);
		border-radius: 50%;
		background: rgb(13 12 11 / 0.6);
		backdrop-filter: blur(10px);
		color: var(--fg-muted);
		cursor: pointer;
	}

	button:hover {
		border-color: var(--fg-subtle);
		color: var(--fg);
	}

	button[aria-pressed='true'] {
		color: var(--fg);
	}
</style>
