import { formatUnits, type Address } from 'viem';

/**
 * An amount of test USDC, as a number. No dollar sign: test USDC is not money,
 * and the page must not make it look like money. Rounds down, so a prize is
 * never shown as more than was paid.
 */
export function usdc(amount: bigint, digits = 2): string {
	const [whole, fraction = ''] = formatUnits(amount, 18).split('.');
	const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
	return `${grouped}.${fraction.padEnd(digits, '0').slice(0, digits)}`;
}

/**
 * A prize. Small ones are shown to four places: rounded to two, different
 * prizes from one drop too often look the same.
 */
export function usdcPrize(amount: bigint): string {
	return usdc(amount, amount < 100n * 10n ** 18n ? 4 : 2);
}

export function shortAddress(address: Address): string {
	return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/** How long until `expiresAt`, both in seconds. Empty once it has passed. */
export function timeLeft(expiresAt: number, now: number): string {
	const seconds = expiresAt - now;
	if (seconds <= 0) return '';
	const days = Math.floor(seconds / 86400);
	const hours = Math.floor((seconds % 86400) / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	if (days > 0) return `${days}d ${hours}h`;
	if (hours > 0) return `${hours}h ${minutes}m`;
	if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
	return `${seconds}s`;
}
