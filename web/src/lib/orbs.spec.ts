import { describe, expect, it } from 'vitest';
import { dropState, mergeDrops, mergePulls, prizeTier, type Drop, type Pull } from './orbs';

const USDC = 10n ** 18n;

function drop(over: Partial<Drop> = {}): Drop {
	return {
		id: 0,
		creator: '0x0000000000000000000000000000000000000001',
		expiresAt: 2000,
		prizes: 10,
		pool: 10n * USDC,
		remaining: 10n * USDC,
		drawn: 0,
		luckiest: '0x0000000000000000000000000000000000000000',
		best: 0n,
		note: '',
		...over
	};
}

describe('dropState', () => {
	it('is live until it closes or runs out', () => {
		expect(dropState(drop(), 1999)).toBe('live');
		expect(dropState(drop(), 2000)).toBe('closed');
		expect(dropState(drop({ drawn: 10 }), 1000)).toBe('empty');
	});

	it('calls a drop that ran out empty even after it closes', () => {
		expect(dropState(drop({ drawn: 10 }), 3000)).toBe('empty');
	});
});

describe('prizeTier', () => {
	// An even share of this drop is $1.
	it('ranks a prize against an even share of the pool', () => {
		expect(prizeTier(USDC / 100n, drop())).toBe(0);
		expect(prizeTier((USDC * 49n) / 100n, drop())).toBe(0);
		expect(prizeTier((USDC * 50n) / 100n, drop())).toBe(1);
		expect(prizeTier((USDC * 150n) / 100n, drop())).toBe(2);
		expect(prizeTier(3n * USDC, drop())).toBe(3);
		expect(prizeTier(9n * USDC, drop())).toBe(3);
	});
});

describe('mergePulls', () => {
	const pulls = (...indexes: number[]): Pull[] =>
		indexes.map((index) => ({
			index,
			player: `0x${index.toString(16).padStart(40, '0')}`,
			amount: BigInt(index + 1)
		}));
	const indexes = (list: Pull[]) => list.map((pull) => pull.index);

	it('puts newer pulls on top without repeating the ones it has', () => {
		expect(indexes(mergePulls(pulls(5, 4, 3), pulls(7, 6, 5, 4)))).toEqual([7, 6, 5, 4, 3]);
	});

	it('adds an older page underneath', () => {
		expect(indexes(mergePulls(pulls(9, 8, 7), pulls(6, 5, 4)))).toEqual([9, 8, 7, 6, 5, 4]);
	});

	it('starts over from a page that does not reach what it has', () => {
		expect(indexes(mergePulls(pulls(5, 4, 3), pulls(20, 19, 18)))).toEqual([20, 19, 18]);
	});

	it('keeps what it has when a page is empty', () => {
		expect(indexes(mergePulls(pulls(2, 1, 0), []))).toEqual([2, 1, 0]);
	});
});

describe('mergeDrops', () => {
	const ids = (list: Drop[]) => list.map((item) => item.id);

	it('keeps drops newest first, whichever page they came in', () => {
		const known = [drop({ id: 5 }), drop({ id: 4 })];
		expect(ids(mergeDrops(known, [drop({ id: 3 }), drop({ id: 2 })]))).toEqual([5, 4, 3, 2]);
		expect(ids(mergeDrops(known, [drop({ id: 7 }), drop({ id: 6 }), drop({ id: 5 })]))).toEqual([
			7, 6, 5, 4
		]);
	});

	it("takes the page's copy of a drop it already has", () => {
		const merged = mergeDrops([drop({ id: 1, drawn: 2 })], [drop({ id: 1, drawn: 3 })]);
		expect(merged).toHaveLength(1);
		expect(merged[0].drawn).toBe(3);
	});
});
