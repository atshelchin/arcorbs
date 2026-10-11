import { getAddress, numberToHex, type Address, type Hex } from 'viem';
import { browser } from '$app/env';
import { orbsAbi } from './abi';
import { arc, ARC_CHAIN_ID_HEX, client, orbsAddress } from './arc';

export interface Eip1193Provider {
	request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
	on?(event: string, listener: (...args: never[]) => void): unknown;
	removeListener?(event: string, listener: (...args: never[]) => void): unknown;
	isVela?: boolean;
}

/** A wallet found in the page, by EIP-6963 or on `window.ethereum`. */
export interface WalletOption {
	id: string;
	name: string;
	icon?: string;
	provider: Eip1193Provider;
	isVela: boolean;
}

/**
 * What the game makes of the connected account.
 *
 * - `vela`: the ArcOrbs contract confirms it is a Vela account.
 * - `new-vela`: Vela Wallet is connected, and the account has no code on Arc
 *   Testnet yet. A Vela account is deployed by its first transaction, so the
 *   contract can only confirm it then.
 * - `not-vela`: any other account. It can look, not play.
 */
export type Standing = 'checking' | 'vela' | 'new-vela' | 'not-vela';

export interface RpcReceipt {
	transactionHash: Hex;
	blockNumber: Hex;
	logs: { address: Address; topics: [Hex, ...Hex[]]; data: Hex }[];
}

const VELA_RDNS = 'app.getvela';
const REMEMBERED = 'arc-orbs:wallet';

function rpcCode(error: unknown): number | undefined {
	return typeof error === 'object' && error !== null && 'code' in error
		? Number((error as { code: unknown }).code)
		: undefined;
}

class Wallet {
	options = $state<WalletOption[]>([]);
	current = $state<WalletOption | null>(null);
	account = $state<Address | null>(null);
	balance = $state<bigint | null>(null);
	standing = $state<Standing>('checking');
	/** The id of the option being connected to. */
	connecting = $state<string | null>(null);
	error = $state<string | null>(null);
	pickerOpen = $state(false);

	canPlay = $derived(this.standing === 'vela' || this.standing === 'new-vela');

	#listening = false;
	#onAccounts = (accounts: string[]) => {
		if (accounts.length === 0) this.disconnect();
		else this.#setAccount(accounts[0]);
	};
	#onDisconnect = () => this.disconnect();

	/** Starts looking for wallets. Safe to call more than once. */
	discover() {
		if (!browser || this.#listening) return;
		this.#listening = true;

		window.addEventListener('eip6963:announceProvider', (event) => {
			const detail = (event as CustomEvent).detail as
				| {
						info?: { uuid?: string; name?: string; icon?: string; rdns?: string };
						provider?: Eip1193Provider;
				  }
				| undefined;
			if (!detail?.info?.name || typeof detail.provider?.request !== 'function') return;
			this.#add({
				id: detail.info.rdns ?? detail.info.uuid ?? detail.info.name,
				name: detail.info.name,
				icon: detail.info.icon,
				provider: detail.provider,
				isVela: detail.info.rdns === VELA_RDNS || detail.provider.isVela === true
			});
		});
		window.dispatchEvent(new Event('eip6963:requestProvider'));

		// A wallet that predates EIP-6963 is only on `window.ethereum`. Wallets
		// that announce themselves answer the request above synchronously, so by
		// now an empty list means nobody will.
		const legacy = (window as { ethereum?: Eip1193Provider }).ethereum;
		if (this.options.length === 0 && typeof legacy?.request === 'function') {
			this.#add({
				id: 'window.ethereum',
				name: legacy.isVela ? 'Vela Wallet' : 'Browser wallet',
				provider: legacy,
				isVela: legacy.isVela === true
			});
		}
	}

	#add(option: WalletOption) {
		if (this.options.some((known) => known.id === option.id)) return;
		this.options = [...this.options, option].sort((a, b) => Number(b.isVela) - Number(a.isVela));
		if (!this.current && localStorage.getItem(REMEMBERED) === option.id) void this.#resume(option);
	}

	/** Reconnects without a prompt, if the wallet still shares an account. */
	async #resume(option: WalletOption) {
		try {
			const accounts = (await option.provider.request({ method: 'eth_accounts' })) as string[];
			if (accounts.length > 0 && !this.current) this.#adopt(option, accounts[0]);
		} catch {
			// The wallet would rather be asked again.
		}
	}

	async connect(option: WalletOption) {
		this.connecting = option.id;
		this.error = null;
		try {
			const accounts = (await option.provider.request({
				method: 'eth_requestAccounts'
			})) as string[];
			if (accounts.length === 0) throw new Error('The wallet did not share an account.');
			this.#adopt(option, accounts[0]);
			localStorage.setItem(REMEMBERED, option.id);
			this.pickerOpen = false;
		} catch (error) {
			this.error =
				rpcCode(error) === 4001 ? 'Connection cancelled.' : 'Could not connect to that wallet.';
		} finally {
			this.connecting = null;
		}
	}

	disconnect() {
		this.current?.provider.removeListener?.('accountsChanged', this.#onAccounts);
		this.current?.provider.removeListener?.('disconnect', this.#onDisconnect);
		this.current = null;
		this.account = null;
		this.balance = null;
		this.standing = 'checking';
		localStorage.removeItem(REMEMBERED);
	}

	#adopt(option: WalletOption, account: string) {
		if (this.current) this.disconnect();
		this.current = option;
		option.provider.on?.('accountsChanged', this.#onAccounts);
		option.provider.on?.('disconnect', this.#onDisconnect);
		this.#setAccount(account);
	}

	#setAccount(account: string) {
		const next = getAddress(account);
		if (next === this.account) return;
		this.account = next;
		this.balance = null;
		this.standing = 'checking';
		void this.refresh();
	}

	/** Re-reads the account's balance and whether it is a Vela account. */
	async refresh() {
		const account = this.account;
		const option = this.current;
		if (!account || !option) return;

		let standing: Standing;
		try {
			const [code, balance] = await Promise.all([
				client.getCode({ address: account }),
				client.getBalance({ address: account })
			]);
			if (this.account !== account) return;
			this.balance = balance;

			if (!code || code === '0x') {
				standing = option.isVela ? 'new-vela' : 'not-vela';
			} else {
				const isVela = await client.readContract({
					address: orbsAddress,
					abi: orbsAbi,
					functionName: 'isVelaWallet',
					args: [account]
				});
				standing = isVela ? 'vela' : 'not-vela';
			}
		} catch {
			// Arc did not answer. The contract decides in the end; until then,
			// go by the wallet.
			standing = option.isVela ? 'vela' : 'not-vela';
		}
		if (this.account === account) this.standing = standing;
	}

	/** Moves the wallet to Arc Testnet, adding the network to wallets that lack it. */
	async #switchToArc(provider: Eip1193Provider) {
		const chainId = (await provider.request({ method: 'eth_chainId' })) as string;
		if (Number(chainId) === arc.id) return;
		try {
			await provider.request({
				method: 'wallet_switchEthereumChain',
				params: [{ chainId: ARC_CHAIN_ID_HEX }]
			});
		} catch (error) {
			if (rpcCode(error) !== 4902) throw error;
			await provider.request({
				method: 'wallet_addEthereumChain',
				params: [
					{
						chainId: ARC_CHAIN_ID_HEX,
						chainName: arc.name,
						nativeCurrency: arc.nativeCurrency,
						rpcUrls: arc.rpcUrls.default.http,
						blockExplorerUrls: [arc.blockExplorers.default.url]
					}
				]
			});
		}
	}

	/** Asks the wallet to send a transaction on Arc Testnet and returns what it answers. */
	async send(transaction: { to: Address; data: Hex; value?: bigint }): Promise<Hex> {
		const provider = this.current?.provider;
		if (!provider || !this.account) throw new Error('Connect a wallet first.');
		await this.#switchToArc(provider);
		return (await provider.request({
			method: 'eth_sendTransaction',
			params: [
				{
					from: this.account,
					to: transaction.to,
					data: transaction.data,
					value: numberToHex(transaction.value ?? 0n)
				}
			]
		})) as Hex;
	}

	/**
	 * The receipt of something `send` returned, or `null` while it is pending.
	 *
	 * Asked of the wallet first: Vela answers `eth_sendTransaction` with a user
	 * operation's hash, which only Vela can turn into the transaction it landed in.
	 */
	async receipt(hash: Hex): Promise<RpcReceipt | null> {
		try {
			const receipt = await this.current?.provider.request({
				method: 'eth_getTransactionReceipt',
				params: [hash]
			});
			if (receipt) return receipt as RpcReceipt;
		} catch {
			// Not every wallet serves reads. Arc itself is asked below.
		}
		return (await client.request({
			method: 'eth_getTransactionReceipt',
			params: [hash]
		})) as RpcReceipt | null;
	}
}

export const wallet = new Wallet();
