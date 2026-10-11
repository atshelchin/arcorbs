import { Resvg } from '@cf-wasm/resvg';
import { read } from '$app/server';
import extraBold from './PlusJakartaSans-ExtraBold.ttf';
import medium from './PlusJakartaSans-Medium.ttf';
import scene from './scene.jpg';

/**
 * The picture a shared link unfolds into on X and in chat apps.
 *
 * A post cannot carry an image from the web, but a link can: the reader's app
 * fetches this card. So it does the inviting — the amount in the largest type
 * on it, and one thing to do next.
 *
 * The backdrop is a still of the site's own scene. Only facts that cannot
 * change go on a card, because the apps that show it keep their copy for days.
 *
 * Every card is marked TESTNET and names its amounts as test USDC: a picture
 * travels further than the page it came from, and must not pass for money.
 */
export type Card =
	| { kind: 'home' }
	/** An account's pull. */
	| { kind: 'won'; player: string; amount: string }
	/** A drop that can still be pulled from. */
	| { kind: 'open'; pool: string; prizes: number; note: string }
	/** A drop that is empty or closed. */
	| { kind: 'over'; pool: string; drawn: number };

const WIDTH = 1200;
const HEIGHT = 630;

let assets: Promise<{ fonts: Uint8Array[]; backdrop: string }> | undefined;

function loadAssets() {
	return (assets ??= (async () => {
		const [bold, regular, image] = await Promise.all(
			[extraBold, medium, scene].map(
				async (asset) => new Uint8Array(await read(asset).arrayBuffer())
			)
		);
		let binary = '';
		for (let i = 0; i < image.length; i += 0x8000) {
			binary += String.fromCharCode(...image.subarray(i, i + 0x8000));
		}
		return { fonts: [bold, regular], backdrop: `data:image/jpeg;base64,${btoa(binary)}` };
	})());
}

function escape(text: string): string {
	return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

/** The card's fonts are Latin; a note in another script would print as boxes. */
function printable(note: string): string {
	const trimmed = note.trim();
	if (!/^[\x20-\x7e\u00a0-\u024f\u2018-\u201d\u2026]+$/.test(trimmed)) return '';
	return trimmed.length > 46 ? `${trimmed.slice(0, 45).trimEnd()}…` : trimmed;
}

/** Large while it fits beside the scene, smaller as the number grows. */
function amountSize(amount: string): number {
	if (amount.length <= 5) return 176;
	if (amount.length <= 6) return 154;
	if (amount.length <= 7) return 132;
	if (amount.length <= 9) return 106;
	return 84;
}

function body(card: Card): string {
	const eyebrow = (text: string, fill: string) =>
		`<text x="66" y="226" font-size="27" font-weight="800" letter-spacing="4" fill="${fill}">${escape(text)}</text>`;
	const amount = (text: string) => {
		const size = amountSize(text);
		return `<text x="60" y="${246 + size * 0.84}" font-size="${size}" font-weight="800" letter-spacing="${-size * 0.04}" fill="url(#gold)">${escape(text)}</text>`;
	};
	const line = (text: string, y: number, fill = '#ece9e3', size = 33) =>
		`<text x="66" y="${y}" font-size="${size}" font-weight="500" fill="${fill}">${escape(text)}</text>`;
	const action = (text: string) => `
		<rect x="64" y="508" width="${46 + text.length * 16.5}" height="70" rx="35" fill="#f0623a"/>
		<text x="${87 + text.length * 8.25}" y="553" text-anchor="middle" font-size="29" font-weight="800" fill="#190c07">${escape(text)}</text>
		<text x="${136 + text.length * 16.5}" y="553" font-size="26" font-weight="500" fill="#a8a49b">Only for Vela Wallet</text>`;

	switch (card.kind) {
		case 'won':
			return (
				eyebrow(`${card.player} JUST PULLED`, '#f5b54a') +
				amount(card.amount) +
				line('test USDC from an Arc Orb', 452) +
				action('Pull your orb')
			);
		case 'open': {
			const note = printable(card.note);
			return (
				eyebrow('WAITING TO BE PULLED', '#ff7a52') +
				amount(card.pool) +
				line(
					`test USDC in ${card.prizes} ${card.prizes === 1 ? 'orb' : 'orbs'}, one pull each`,
					note ? 436 : 452
				) +
				(note ? line(`“${note}”`, 476, '#a8a49b', 26) : '') +
				action('Pull an orb')
			);
		}
		case 'over':
			return (
				eyebrow('EVERY ORB PULLED', '#a8a49b') +
				amount(card.pool) +
				line(
					`test USDC went to ${card.drawn} Vela ${card.drawn === 1 ? 'account' : 'accounts'}`,
					452
				) +
				action('Find an open drop')
			);
		case 'home':
			return (
				eyebrow('A GAME ON ARC TESTNET', '#4c9bf0') +
				`<text x="62" y="322" font-size="88" font-weight="800" letter-spacing="-3.5" fill="#ece9e3">Pull an orb.</text>` +
				`<text x="62" y="414" font-size="78" font-weight="800" letter-spacing="-3" fill="url(#gold)">See what it holds.</text>` +
				line('Played with test USDC, which is worth nothing', 466, '#a8a49b', 30) +
				action('Pull an orb')
			);
	}
}

export async function renderCard(card: Card): Promise<Uint8Array> {
	const { fonts, backdrop } = await loadAssets();
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" font-family="Plus Jakarta Sans">
		<defs>
			<linearGradient id="gold" x1="0" y1="0" x2="0" y2="1">
				<stop offset="0.1" stop-color="#fff6e6"/>
				<stop offset="0.72" stop-color="#f5b54a"/>
				<stop offset="1" stop-color="#f0623a"/>
			</linearGradient>
			<linearGradient id="shade" x1="0" y1="0" x2="1" y2="0">
				<stop offset="0" stop-color="#0d0c0b" stop-opacity="0.9"/>
				<stop offset="0.42" stop-color="#0d0c0b" stop-opacity="0.72"/>
				<stop offset="0.7" stop-color="#0d0c0b" stop-opacity="0"/>
			</linearGradient>
		</defs>
		<image href="${backdrop}" width="${WIDTH}" height="${HEIGHT}"/>
		<rect width="${WIDTH}" height="${HEIGHT}" fill="url(#shade)"/>
		<path d="M66 96a22 22 0 0 1 44 0" fill="none" stroke="#f0623a" stroke-width="6.5" stroke-linecap="round"/>
		<circle cx="88" cy="96" r="8" fill="#4c9bf0"/>
		<text x="128" y="104" font-size="38" font-weight="800" letter-spacing="-0.8" fill="#ece9e3"><tspan fill="#4c9bf0">Arc</tspan> Orbs</text>
		<rect x="318" y="72" width="132" height="42" rx="21" fill="#f5b54a" fill-opacity="0.16"/><text x="384" y="101" text-anchor="middle" font-size="21" font-weight="800" letter-spacing="2" fill="#f5b54a">TESTNET</text>
		${body(card)}
	</svg>`;

	const resvg = await Resvg.async(svg, {
		font: { fontBuffers: fonts, loadSystemFonts: false, defaultFontFamily: 'Plus Jakarta Sans' }
	});
	return resvg.render().asPng();
}

export function cardResponse(png: Uint8Array, maxAge: number): Response {
	return new Response(png as BodyInit, {
		headers: {
			'content-type': 'image/png',
			'cache-control': `public, max-age=${maxAge}`
		}
	});
}
