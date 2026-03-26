import { GraphQLClient, gql } from "graphql-request";
import type { RawSubgraphItem } from "./types.js";

const ITEMS_QUERY = gql`
  query GetItems($registryAddress: String!, $lastId: String!, $first: Int!) {
    items(
      where: { registryAddress: $registryAddress, id_gt: $lastId }
      orderBy: id
      orderDirection: asc
      first: $first
    ) {
      id
      itemID
      status
      metadata {
        key0
        key2
      }
      challenges(orderBy: challengeID, orderDirection: desc, first: 1) {
        disputeOutcome
        disputeID
        resolutionTime
      }
      stake
    }
  }
`;

interface ItemsResponse {
	items: RawSubgraphItem[];
}

/**
 * Fetch all PGTCR items from the subgraph using id_gt cursor pagination.
 * Never uses skip-based pagination (degrades >5000 items).
 * Returns ALL items including Absent status (needed for Scenarios 2 and 3).
 */
export async function fetchAllItems(subgraphUrl: string, registryAddress: string): Promise<RawSubgraphItem[]> {
	const client = new GraphQLClient(subgraphUrl);
	const allItems: RawSubgraphItem[] = [];
	let lastId = "";
	const pageSize = 1000;

	while (true) {
		const data = await client.request<ItemsResponse>(ITEMS_QUERY, {
			registryAddress: registryAddress.toLowerCase(),
			lastId,
			first: pageSize,
		});

		const items = data.items;
		if (items.length === 0) break;

		allItems.push(...items);
		// Use entity `id` (primary key) for cursor, NOT `itemID` (bytes32 hash) -- Pitfall 1
		lastId = items[items.length - 1].id;

		if (items.length < pageSize) break;
	}

	console.log(`Fetched ${allItems.length} items from subgraph`);
	return allItems;
}
