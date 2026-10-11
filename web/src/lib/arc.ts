import {
	createPublicClient,
	defineChain,
	fallback,
	http,
	numberToHex,
	type Address,
	type Hex
} from 'viem';
import { ARC_ORBS_ADDRESS, ARC_RPC_URL } from '$app/env/public';

/**
 * Arc Orbs is played on Arc's testnet and nowhere else. USDC there is free
 * from a faucet and worth nothing, which is what makes this a game and not a
 * giveaway. Nothing here knows about Arc's mainnet, and that is on purpose.
 */
export const arc = defineChain({
	id: 5042002,
	name: 'Arc Testnet',
	// Arc's gas coin is USDC, held on chain with 18 decimals.
	nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
	rpcUrls: {
		default: {
			http: ARC_RPC_URL
				? [ARC_RPC_URL]
				: ['https://rpc.testnet.arc.network', 'https://rpc.testnet.arc.io']
		}
	},
	blockExplorers: { default: { name: 'Arcscan', url: 'https://testnet.arcscan.app' } },
	contracts: { multicall3: { address: '0xcA11bde05977b3631167028862bE2a173976CA11' } },
	testnet: true
});

export const ARC_CHAIN_ID_HEX = numberToHex(arc.id);

/** The ArcOrbs contract (contracts/src/ArcOrbs.sol). */
export const orbsAddress: Address =
	ARC_ORBS_ADDRESS ?? '0x0e7eee70d68E2b7Cfaf21D51C7D401391c27829b';

/** Where test USDC comes from. */
export const FAUCET = 'https://faucet.circle.com';

/** What the game's coin is called wherever an amount is shown. */
export const COIN = 'test USDC';

export const client = createPublicClient({
	chain: arc,
	transport: fallback(arc.rpcUrls.default.http.map((url) => http(url))),
	batch: { multicall: true }
});

export function explorerTx(hash: Hex): string {
	return `${arc.blockExplorers.default.url}/tx/${hash}`;
}

export function explorerAddress(address: Address): string {
	return `${arc.blockExplorers.default.url}/address/${address}`;
}
