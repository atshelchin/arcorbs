import { isAddress } from 'viem';
import { BRAND } from '#lib/brand.ts';
import { shortAddress, usdc, usdcPrize } from '#lib/format.ts';
import { fetchDrop, fetchPrize } from '#lib/orbs.ts';
import type { PageServerLoad } from './$types';

/**
 * What a link to this drop says about itself when it is shared: a title, a
 * line, and the card at `card.png`. With `?by=<account>` it speaks for that
 * account's pull.
 *
 * The page reads the drop again in the browser, so a slow or missing answer
 * here only costs the link its own words.
 */
export const load: PageServerLoad = async ({ params, url }) => {
	if (!/^\d{1,9}$/.test(params.id)) return {};
	const id = Number(params.id);
	const by = url.searchParams.get('by');
	const player = by && isAddress(by) ? by : null;

	try {
		const [drop, prize] = await Promise.race([
			Promise.all([fetchDrop(id), player ? fetchPrize(id, player).catch(() => 0n) : 0n]),
			new Promise<never>((_, reject) => setTimeout(reject, 2500))
		]);
		const filled = `${usdc(drop.pool)} test USDC in ${drop.prizes} ${drop.prizes === 1 ? 'orb' : 'orbs'}`;
		const closing = 'A game on Arc Testnet for Vela Wallet: test USDC is free and worth nothing.';

		if (player && prize > 0n) {
			return {
				card: {
					title: `${shortAddress(player)} just pulled ${usdcPrize(prize)} test USDC on ${BRAND}`,
					description: `From a drop of ${filled}. ${closing}`,
					image: `${url.pathname}/card.png?by=${player}`
				}
			};
		}
		return {
			card: {
				title: `${drop.note || 'A lucky drop'} — ${usdc(drop.pool)} test USDC on ${BRAND}`,
				description: `${filled}, one pull per Vela account. ${closing}`,
				image: `${url.pathname}/card.png`
			}
		};
	} catch {
		return {};
	}
};
