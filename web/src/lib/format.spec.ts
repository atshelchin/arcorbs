import { describe, expect, it } from 'vitest';
import { shortAddress, timeLeft, usdc, usdcPrize } from './format';

const USDC = 10n ** 18n;

describe('usdc', () => {
	it('writes an amount to two places', () => {
		expect(usdc(0n)).toBe('0.00');
		expect(usdc(USDC)).toBe('1.00');
		expect(usdc(1234567n * USDC + USDC / 2n)).toBe('1,234,567.50');
	});

	it('rounds down, so a prize is never shown as more than was paid', () => {
		expect(usdc(USDC - 1n)).toBe('0.99');
		expect(usdc(USDC / 100n - 1n)).toBe('0.00');
	});

	it('shows as many decimals as asked', () => {
		expect(usdc(USDC / 8n, 4)).toBe('0.1250');
	});
});

describe('usdcPrize', () => {
	it('tells apart two small prizes that share their cents', () => {
		expect(usdcPrize(786351735409989918n)).toBe('0.7863');
		expect(usdcPrize(787215907332954758n)).toBe('0.7872');
	});

	it('shows a large prize in cents', () => {
		expect(usdcPrize(100n * USDC)).toBe('100.00');
		expect(usdcPrize(99n * USDC + USDC / 2n)).toBe('99.5000');
	});
});

describe('timeLeft', () => {
	it('uses the two largest units that matter', () => {
		expect(timeLeft(1000 + 2 * 86400 + 3 * 3600 + 59, 1000)).toBe('2d 3h');
		expect(timeLeft(1000 + 3 * 3600 + 12 * 60, 1000)).toBe('3h 12m');
		expect(timeLeft(1000 + 4 * 60 + 10, 1000)).toBe('4m 10s');
		expect(timeLeft(1045, 1000)).toBe('45s');
	});

	it('is empty once the time has passed', () => {
		expect(timeLeft(1000, 1000)).toBe('');
		expect(timeLeft(999, 1000)).toBe('');
	});
});

describe('shortAddress', () => {
	it('keeps both ends', () => {
		expect(shortAddress('0x86c1474862eCd8b8e2552A0e606E81c0C2bc3C24')).toBe('0x86c1…3C24');
	});
});
