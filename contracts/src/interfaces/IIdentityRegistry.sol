// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IIdentityRegistry
/// @notice Pinned interface for the ERC-8004 IdentityRegistry deployed on Sepolia
/// @dev Address: 0x8004A818BFB912233c491871b3d84c89A494BD9e
interface IIdentityRegistry {
    function register(string calldata agentURI) external returns (uint256 agentId);
    function ownerOf(uint256 agentId) external view returns (address);
    function setAgentURI(uint256 agentId, string calldata agentURI) external;
    function tokenURI(uint256 agentId) external view returns (string memory);
}
