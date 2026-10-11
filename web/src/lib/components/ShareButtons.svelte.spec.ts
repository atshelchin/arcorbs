import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import ShareButtons from './ShareButtons.svelte';

describe('ShareButtons.svelte', () => {
	it('links to a post on X that carries the text and the link', async () => {
		render(ShareButtons, { text: 'I pulled an orb', url: 'https://example.com/drop/1?by=0xabc' });

		await expect
			.element(page.getByRole('link', { name: 'Share on X' }))
			.toHaveAttribute(
				'href',
				'https://x.com/intent/post?text=I%20pulled%20an%20orb&url=https%3A%2F%2Fexample.com%2Fdrop%2F1%3Fby%3D0xabc'
			);
		await expect.element(page.getByRole('button', { name: 'Copy link' })).toBeInTheDocument();
	});
});
