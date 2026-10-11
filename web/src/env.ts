import { defineEnvVars } from '@sveltejs/kit/env';

export const variables = defineEnvVars({
	ARC_ORBS_ADDRESS: {
		public: true,
		static: true,
		description: 'An ArcOrbs contract to use instead of the deployed one: a fork, or a new build.',
		schema: (value) => {
			if (!value) return undefined;
			if (!/^0x[0-9a-fA-F]{40}$/.test(value))
				throw new Error('ARC_ORBS_ADDRESS must be an address');
			return value as `0x${string}`;
		}
	},
	ARC_RPC_URL: {
		public: true,
		static: true,
		description: 'An Arc Testnet node to read from instead of the public ones.',
		schema: (value) => value || undefined
	}
});
