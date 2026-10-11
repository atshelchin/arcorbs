import { describe, expect, it } from 'vitest';
import { postOnX } from './share';

describe('postOnX', () => {
	it('carries the text and the link, each escaped', () => {
		const link = new URL(postOnX('I pulled $3.81 & more', 'https://example.com/drop/1?by=0xabc'));
		expect(link.origin + link.pathname).toBe('https://x.com/intent/post');
		expect(link.searchParams.get('text')).toBe('I pulled $3.81 & more');
		expect(link.searchParams.get('url')).toBe('https://example.com/drop/1?by=0xabc');
	});
});
