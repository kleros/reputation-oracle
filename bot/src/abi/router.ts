export const routerAbi = [
	{
		type: "function",
		name: "feedbackType",
		stateMutability: "view",
		inputs: [{ name: "agentId", type: "uint256" }],
		outputs: [{ name: "", type: "uint8" }],
	},
	{
		type: "function",
		name: "submitPositiveFeedback",
		stateMutability: "nonpayable",
		inputs: [
			{ name: "agentId", type: "uint256" },
			{ name: "pgtcrItemId", type: "bytes32" },
			{ name: "feedbackURI", type: "string" },
		],
		outputs: [],
	},
	{
		type: "function",
		name: "submitNegativeFeedback",
		stateMutability: "nonpayable",
		inputs: [
			{ name: "agentId", type: "uint256" },
			{ name: "feedbackURI", type: "string" },
		],
		outputs: [],
	},
	{
		type: "function",
		name: "revokeOnly",
		stateMutability: "nonpayable",
		inputs: [{ name: "agentId", type: "uint256" }],
		outputs: [],
	},
	{
		type: "function",
		name: "authorizedBots",
		stateMutability: "view",
		inputs: [{ name: "bot", type: "address" }],
		outputs: [{ name: "", type: "bool" }],
	},
] as const;
