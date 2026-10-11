import { error } from '@sveltejs/kit';
import { isAddress } from 'viem';
import { shortAddress, usdc, usdcPrize } from '#lib/format.ts';
import { dropState, fetchDrop, fetchPrize, type Drop } from '#lib/orbs.ts';
import { cardResponse, renderCard } from '#lib/server/card/card.ts';
import type { RequestHandler } from './$types';

/**
 * The card for a link to a drop. With `?by=<account>` it is that account's
 * pull, read from the chain — a link cannot claim a pull that never happened.
 */
export const GET: RequestHandler = async ({ params, url }) => {
	let drop: Drop;
	try {
		if (!/^\d{1,9}$/.test(params.id)) throw new Error('not an id');
		drop = await fetchDrop(Number(params.id));
	} catch {
		error(404, 'No such drop');
	}

	const by = url.searchParams.get('by');
	if (by && isAddress(by)) {
		const prize = await fetchPrize(drop.id, by).catch(() => 0n);
		if (prize > 0n) {
			// A pull never changes, so neither does its card.
			return cardResponse(
				await renderCard({ kind: 'won', player: shortAddress(by), amount: usdcPrize(prize) }),
				604800
			);
		}
	}

	if (dropState(drop, Math.floor(Date.now() / 1000)) === 'live') {
		return cardResponse(
			await renderCard({
				kind: 'open',
				pool: usdc(drop.pool),
				prizes: drop.prizes,
				note: drop.note
			}),
			300
		);
	}
	return cardResponse(
		await renderCard({ kind: 'over', pool: usdc(drop.pool), drawn: drop.drawn }),
		3600
	);
};
