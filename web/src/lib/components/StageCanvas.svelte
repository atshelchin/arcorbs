<script lang="ts">
	import { onMount } from 'svelte';
	import { arc } from '#lib/arc.ts';
	import { live } from '#lib/live.svelte.ts';
	import type { Stage } from '#lib/stage/Stage.ts';

	let {
		prizes,
		drawn,
		shift = 0,
		hud = 'left',
		stage = $bindable()
	}: {
		prizes: number;
		drawn: number;
		shift?: number;
		hud?: 'left' | 'right';
		stage?: Stage;
	} = $props();

	let canvas: HTMLCanvasElement;
	// No WebGL: the page still works, over a still backdrop.
	let unavailable = $state(false);

	onMount(() => {
		let gone = false;
		let instance: Stage | undefined;
		// three.js is most of this site's weight, and none of it is needed to read a page.
		import('#lib/stage/Stage.ts').then(({ Stage }) => {
			if (gone) return;
			try {
				instance = new Stage(canvas, { shift });
				stage = instance;
			} catch {
				unavailable = true;
			}
		});
		return () => {
			gone = true;
			instance?.dispose();
			stage = undefined;
		};
	});

	$effect(() => {
		stage?.setDrop(prizes, drawn);
	});

	$effect(() => {
		if (live.block !== null) stage?.pulse();
	});
</script>

<div class="stage" class:unavailable>
	<canvas bind:this={canvas} aria-hidden="true"></canvas>
	{#if live.block !== null}
		<p class="arc {hud}" title="Each light on the outer ring is a block landing on {arc.name}">
			<i></i>
			<b>{arc.name}</b>
			<span class="mono">#{live.block.toLocaleString('en-US')}</span>
			{#if live.blockTime !== null}
				<span class="pace">a block every {live.blockTime.toFixed(1)}s</span>
			{/if}
		</p>
	{/if}
</div>

<style>
	.stage {
		position: absolute;
		inset: 0;
		background:
			radial-gradient(60% 50% at 50% 45%, rgb(76 155 240 / 0.16), transparent 70%),
			radial-gradient(50% 40% at 70% 75%, rgb(240 98 58 / 0.12), transparent 70%), var(--bg);
	}

	canvas {
		display: block;
		width: 100%;
		height: 100%;
		/* A sideways drag turns the arc; an up-and-down one still scrolls the page. */
		touch-action: pan-y;
		cursor: grab;
	}

	.arc {
		position: absolute;
		z-index: 3;
		left: var(--gutter);
		bottom: 14px;
		display: flex;
		align-items: center;
		gap: 7px;
		font-size: 12px;
		color: var(--fg-muted);
		pointer-events: none;
	}

	.arc.right {
		left: auto;
		right: var(--gutter);
	}

	.arc i {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--azure);
		box-shadow: 0 0 10px var(--azure);
		animation: beat 1s ease-in-out infinite;
	}

	.arc b {
		font-weight: 700;
		color: var(--azure);
	}

	.pace::before {
		content: '·';
		margin-right: 7px;
	}

	@keyframes beat {
		50% {
			opacity: 0.35;
		}
	}

	.unavailable canvas {
		visibility: hidden;
	}
</style>
