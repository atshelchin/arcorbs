<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		href,
		class: classes = '',
		children
	}: { href: string; class?: string; children: Snippet } = $props();
</script>

<!-- A link out of the site, so there is no route for resolve() to build. -->
<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
<a {href} class={classes} target="_blank" rel="noopener">{@render children()}</a>
