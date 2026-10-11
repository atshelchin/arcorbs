import { cardResponse, renderCard } from '#lib/server/card/card.ts';
import type { RequestHandler } from './$types';

/** The card for links to the site itself. */
export const GET: RequestHandler = async () =>
	cardResponse(await renderCard({ kind: 'home' }), 86400);
