import {
	BaseError,
	ContractFunctionRevertedError,
	encodeFunctionData,
	isAddressEqual,
	parseEventLogs,
	type Address,
	type Hex
} from 'viem';
import { orbsAbi } from './abi';
import { BRAND } from './brand';
import { arc, client, orbsAddress } from './arc';
import { wallet, type RpcReceipt } from './wallet.svelte';

export interface Drop {
	id: number;
	creator: Address;
	/** Unix seconds. */
	expiresAt: number;
	prizes: number;
	pool: bigint;
	remaining: bigint;
	drawn: number;
	luckiest: Address;
	best: bigint;
	note: string;
}

export interface Draw {
	player: Address;
	amount: bigint;
}

/** A draw, and its place among the drop's draws, counted from the first. */
export interface Pull extends Draw {
	index: number;
}

export type DropState = 'live' | 'empty' | 'closed';

/** How a prize compares with an even split, from worst (0) to best (3). */
export type Tier = 0 | 1 | 2 | 3;

export const MIN_PRIZE = 10n ** 16n;
export const MAX_NOTE_LENGTH = 80;

type ChainDrop = Omit<Drop, 'id' | 'expiresAt'> & { expiresAt: bigint };

function toDrop(id: number, drop: ChainDrop): Drop {
	return { ...drop, id, expiresAt: Number(drop.expiresAt) };
}

export function dropState(drop: Drop, now: number): DropState {
	if (drop.drawn >= drop.prizes) return 'empty';
	return now >= drop.expiresAt ? 'closed' : 'live';
}

export function prizeTier(amount: bigint, drop: Pick<Drop, 'pool' | 'prizes'>): Tier {
	// Hundredths of an even share of the whole pool. A pull is worth one share
	// on average: about two in five fall in the lowest tier, and about one in
	// twenty reaches the top.
	const share = (amount * 100n * BigInt(drop.prizes)) / drop.pool;
	if (share >= 300n) return 3;
	if (share >= 150n) return 2;
	if (share >= 50n) return 1;
	return 0;
}

/**
 * One page of the drops, newest first, starting `offset` back from the
 * latest, and how many drops there are in all.
 */
export async function fetchDrops(
	offset = 0,
	limit = 24
): Promise<{ drops: Drop[]; total: number }> {
	const [page, total] = await client.readContract({
		address: orbsAddress,
		abi: orbsAbi,
		functionName: 'getDrops',
		args: [BigInt(offset), BigInt(limit)]
	});
	return {
		drops: page.map((drop, index) => toDrop(Number(total) - 1 - offset - index, drop)),
		total: Number(total)
	};
}

/** Adds a page to the drops already read, newest first. The page's copy of a drop is the fresher one. */
export function mergeDrops(known: Drop[], page: Drop[]): Drop[] {
	const fresh = new Set(page.map((drop) => drop.id));
	return [...page, ...known.filter((drop) => !fresh.has(drop.id))].sort((a, b) => b.id - a.id);
}

export async function fetchDrop(id: number): Promise<Drop> {
	const drop = await client.readContract({
		address: orbsAddress,
		abi: orbsAbi,
		functionName: 'getDrop',
		args: [BigInt(id)]
	});
	return toDrop(id, drop);
}

/**
 * A drop and one page of its pulls, newest first, starting `offset` back from
 * the latest. A drop keeps every pull it has paid, however many; a page is
 * what one call reads of them.
 *
 * The two reads leave together and travel as one call, so the page's places
 * are counted against the drop as it was in the same block.
 */
export async function fetchPulls(
	id: number,
	offset = 0,
	limit = 40
): Promise<{ drop: Drop; pulls: Pull[] }> {
	const [drop, page] = await Promise.all([
		fetchDrop(id),
		client.readContract({
			address: orbsAddress,
			abi: orbsAbi,
			functionName: 'getDraws',
			args: [BigInt(id), BigInt(offset), BigInt(limit)]
		})
	]);
	return {
		drop,
		pulls: page.map((draw, position) => ({ ...draw, index: drop.drawn - 1 - offset - position }))
	};
}

/**
 * Adds a page to the pulls already read, newest first. A page that does not
 * reach them — more pulls landed in between than a page holds — replaces them:
 * a list with a hole in it would say the drop has fewer pulls than it has.
 */
export function mergePulls(known: Pull[], page: Pull[]): Pull[] {
	if (page.length === 0) return known;
	if (known.length === 0) return page;
	const oldestOfPage = page[page.length - 1].index;
	const newestOfPage = page[0].index;
	if (oldestOfPage > known[0].index + 1 || newestOfPage < known[known.length - 1].index - 1) {
		return page;
	}
	const have = new Set(known.map((pull) => pull.index));
	return [...known, ...page.filter((pull) => !have.has(pull.index))].sort(
		(a, b) => b.index - a.index
	);
}

export async function fetchPrize(id: number, player: Address): Promise<bigint> {
	return client.readContract({
		address: orbsAddress,
		abi: orbsAbi,
		functionName: 'prizeOf',
		args: [BigInt(id), player]
	});
}

/** A failure whose message is already written for the person reading it. */
class Outcome extends Error {}

const REVERTS: Record<string, string> = {
	NotVelaWallet: `${BRAND} is only open to Vela Wallet accounts.`,
	NoSuchDrop: 'This drop does not exist.',
	BadPrizeCount: 'A drop needs at least one orb.',
	BadPool: 'The pool must cover at least 0.01 test USDC for every orb.',
	BadDuration: 'A drop stays open between 10 minutes and 30 days.',
	NoteTooLong: 'That note is too long.',
	DropExpired: 'This drop has closed.',
	DropEmpty: 'Every orb in this drop has been pulled.',
	AlreadyDrawn: 'This account has already pulled an orb from this drop.',
	NotCreator: 'Only the account that funded this drop can refund it.',
	NotExpiredYet: 'A drop can be refunded once it has closed.',
	NothingToRefund: 'There is nothing left to refund.',
	TransferFailed: 'Arc refused the payment to this account.'
};

/** A sentence a person can read, for whatever went wrong. */
export function describeError(error: unknown): string {
	if (error instanceof Outcome) return error.message;

	if (error instanceof BaseError) {
		const revert = error.walk((cause) => cause instanceof ContractFunctionRevertedError);
		if (revert instanceof ContractFunctionRevertedError) {
			const known = REVERTS[revert.data?.errorName ?? ''];
			if (known) return known;
		}
		// The dry run failed some other way: the account cannot afford the call,
		// say, or the node did not answer. viem's short message says which.
		return `${arc.name} would not run this: ${sentence(error.shortMessage)}`;
	}

	if (typeof error === 'object' && error !== null) {
		const { code, message } = error as { code?: unknown; message?: unknown };
		if (Number(code) === 4001) return 'Cancelled in your wallet.';
		if (Number(code) === 4902) {
			return `${arc.name} is not in your wallet yet. Add it in your wallet's networks, then try again.`;
		}
		// A wallet that refuses says why. Its own words are worth more than ours.
		if (typeof message === 'string' && message.trim()) {
			return `Your wallet refused this: ${sentence(message)}`;
		}
	}
	return 'Something went wrong. Nothing was sent.';
}

/** Someone else's message, cut to one line that ends like a sentence. */
function sentence(text: string): string {
	const line = text.trim().split('\n')[0].slice(0, 160).trim();
	return /[.!?…]$/.test(line) ? line : `${line}.`;
}

type Call =
	| { functionName: 'create'; args: readonly [number, bigint, string]; value: bigint }
	| { functionName: 'draw'; args: readonly [bigint] }
	| { functionName: 'refund'; args: readonly [bigint] };

interface Waiting {
	/** Whether the call has taken effect on the chain, asked alongside the wallet's receipt. */
	landed?: () => Promise<boolean>;
	/** Called once the wallet has signed and sent. */
	onSent?: () => void;
}

/** Sends one call to the contract from the connected account and waits for Arc. */
async function transact(call: Call, { landed, onSent }: Waiting = {}): Promise<RpcReceipt | null> {
	const address = orbsAddress;
	const account = wallet.account;
	if (!account) throw new Outcome('Connect a wallet first.');

	let hash: Hex;
	try {
		// A dry run names the reason a call would fail before anything is signed.
		// It cannot be run for a Vela account that is not on Arc yet: the contract
		// would not recognise an address without code.
		if (wallet.standing !== 'new-vela') {
			await client.simulateContract({ address, abi: orbsAbi, account, ...call } as never);
		}

		hash = await wallet.send({
			to: address,
			data: encodeFunctionData({ abi: orbsAbi, ...call } as never),
			value: 'value' in call ? call.value : undefined
		});
	} catch (error) {
		// The page shows a sentence; whoever is debugging wants the whole thing.
		console.error(`${BRAND}: ${call.functionName} was not sent`, error);
		throw error;
	}
	onSent?.();

	// Two things are watched at once, and whichever speaks first settles it:
	// the wallet, for a receipt, and the chain, for the call's effect. A wallet
	// can take seconds to turn a user operation into a receipt; the effect is
	// on the chain the moment the block is.
	return new Promise((resolve, reject) => {
		let settled = false;
		const settle = (act: () => void) => {
			if (settled) return;
			settled = true;
			clearTimeout(deadline);
			act();
		};
		const deadline = setTimeout(
			() =>
				settle(() =>
					reject(new Outcome('Arc has not confirmed this yet. Check the activity in your wallet.'))
				),
			120_000
		);
		const watch = async (confirmed: () => Promise<RpcReceipt | null | undefined>) => {
			while (!settled) {
				await new Promise((tick) => setTimeout(tick, 600));
				const answer = await confirmed().catch(() => undefined);
				if (answer !== undefined) settle(() => resolve(answer));
			}
		};

		void watch(async () => (await wallet.receipt(hash)) ?? undefined);
		if (landed) void watch(async () => ((await landed()) ? null : undefined));
	});
}

function eventsOf(receipt: RpcReceipt) {
	const logs = receipt.logs.filter(
		(log) => log.address.toLowerCase() === orbsAddress.toLowerCase()
	);
	return parseEventLogs({ abi: orbsAbi, logs: logs as never });
}

export interface DrawResult {
	amount: bigint;
	/** The Arc transaction the draw landed in, when the wallet could name it. */
	transaction?: Hex;
}

export async function draw(id: number, onSent?: () => void): Promise<DrawResult> {
	const account = wallet.account;
	const receipt = await transact(
		{ functionName: 'draw', args: [BigInt(id)] },
		{
			onSent,
			landed: async () => account !== null && (await fetchPrize(id, account)) > 0n
		}
	);
	if (!receipt) return { amount: await fetchPrize(id, account!) };

	// A user operation that reverts still lands in a successful transaction, so
	// the proof of a draw is its event, never the receipt's status. And that
	// transaction can carry other accounts' operations, so the event has to be
	// this account's.
	for (const event of eventsOf(receipt)) {
		if (
			event.eventName === 'Drawn' &&
			Number(event.args.id) === id &&
			isAddressEqual(event.args.player, account!)
		) {
			return { amount: event.args.amount, transaction: receipt.transactionHash };
		}
	}
	throw new Outcome('The pull did not go through. Nothing was taken from the drop.');
}

/**
 * The Arc transaction an account's pull landed in, read from the contract's
 * own event. A wallet that answers with a user operation's hash cannot always
 * name it in time; the chain always can.
 */
export async function findPull(id: number, player: Address): Promise<Hex | undefined> {
	const latest = await client.getBlockNumber();
	const logs = await client.getContractEvents({
		address: orbsAddress,
		abi: orbsAbi,
		eventName: 'Drawn',
		args: { id: BigInt(id), player },
		// A pull just made is in the last few blocks; Arc's nodes refuse wide ranges.
		fromBlock: latest > 2000n ? latest - 2000n : 0n,
		toBlock: latest
	});
	return logs.at(-1)?.transactionHash;
}

/** Funds a drop and returns its id. */
export async function createDrop(input: {
	pool: bigint;
	prizes: number;
	duration: number;
	note: string;
}): Promise<number> {
	const receipt = await transact({
		functionName: 'create',
		args: [input.prizes, BigInt(input.duration), input.note],
		value: input.pool
	});
	const account = wallet.account;
	for (const event of receipt ? eventsOf(receipt) : []) {
		if (
			event.eventName === 'DropCreated' &&
			account &&
			isAddressEqual(event.args.creator, account)
		) {
			return Number(event.args.id);
		}
	}
	throw new Outcome('The drop was not created. Your test USDC has not moved.');
}

export async function refund(id: number): Promise<void> {
	const receipt = await transact(
		{ functionName: 'refund', args: [BigInt(id)] },
		{ landed: async () => (await fetchDrop(id)).remaining === 0n }
	);
	const refunded = (event: ReturnType<typeof eventsOf>[number]) =>
		event.eventName === 'Refunded' && Number(event.args.id) === id;
	if (receipt && !eventsOf(receipt).some(refunded)) {
		throw new Outcome('The refund did not go through.');
	}
}
