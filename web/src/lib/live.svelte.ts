import { client } from './arc';

/** Arc Testnet's latest block and the wall clock, kept current while the site is open. */
export const live = $state({
	block: null as bigint | null,
	/** Seconds between blocks, measured since the page opened. */
	blockTime: null as number | null,
	/** Unix seconds. */
	now: Math.floor(Date.now() / 1000)
});

export function startLive(): () => void {
	let first: { block: bigint; at: number } | null = null;
	let stopped = false;
	live.block = null;
	live.blockTime = null;

	const tick = async () => {
		live.now = Math.floor(Date.now() / 1000);
		if (document.hidden) {
			// A hidden tab is not polled, so the measurement starts over.
			first = null;
			return;
		}
		try {
			const block = await client.getBlockNumber({ cacheTime: 0 });
			if (stopped) return;
			live.block = block;
			first ??= { block, at: performance.now() };
			const blocks = Number(block - first.block);
			if (blocks >= 8) live.blockTime = (performance.now() - first.at) / 1000 / blocks;
		} catch {
			// The node did not answer; the next tick asks again.
		}
	};
	void tick();
	const interval = setInterval(tick, 1000);
	return () => {
		stopped = true;
		clearInterval(interval);
	};
}
