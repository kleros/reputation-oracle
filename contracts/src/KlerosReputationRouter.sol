// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

import {IReputationRegistry} from "./interfaces/IReputationRegistry.sol";
import {IIdentityRegistry} from "./interfaces/IIdentityRegistry.sol";

/// @title KlerosReputationRouter
/// @notice Routes Kleros PGTCR curation events to ERC-8004 reputation feedback.
/// @dev Deployed as a UUPS proxy. The Router is the `clientAddress` for ReputationRegistry.
contract KlerosReputationRouter is Initializable, UUPSUpgradeable, OwnableUpgradeable, IERC721Receiver {
    // ─── Enums ──────────────────────────────────────────────────────────────────

    /// @notice Tracks the current feedback state for each agentId.
    enum FeedbackType {
        None,
        Positive,
        Negative
    }

    // ─── Constants ──────────────────────────────────────────────────────────────

    int128 public constant POSITIVE_VALUE = 95;
    int128 public constant NEGATIVE_VALUE = -95;
    uint8 public constant VALUE_DECIMALS = 0;
    string public constant TAG_VERIFIED = "verified";
    string public constant TAG_REMOVED = "removed";
    string public constant TAG_REGISTRY = "kleros-agent-registry";

    // ─── State Variables ────────────────────────────────────────────────────────

    IReputationRegistry public reputationRegistry;
    IIdentityRegistry public identityRegistry;
    uint256 public klerosAgentId;
    mapping(address => bool) public authorizedBots;
    mapping(uint256 => FeedbackType) public feedbackType;
    mapping(uint256 => uint64) public feedbackIndex;

    // ─── Events ─────────────────────────────────────────────────────────────────

    event PositiveFeedbackSubmitted(uint256 indexed agentId, bytes32 indexed pgtcrItemId, uint64 feedbackIndex);
    event NegativeFeedbackSubmitted(uint256 indexed agentId, uint64 feedbackIndex);
    event FeedbackRevoked(uint256 indexed agentId);
    event BotAuthorizationChanged(address indexed bot, bool authorized);
    event AgentRegistered(uint256 indexed agentId, string agentURI);

    // ─── Custom Errors ──────────────────────────────────────────────────────────

    error KRR_NotAuthorizedBot();
    error KRR_AlreadyHasPositiveFeedback(uint256 agentId);
    error KRR_AlreadyHasNegativeFeedback(uint256 agentId);
    error KRR_NoPositiveFeedbackToRevoke(uint256 agentId);

    // ─── Modifiers ──────────────────────────────────────────────────────────────

    modifier onlyAuthorizedBot() {
        if (!authorizedBots[msg.sender]) revert KRR_NotAuthorizedBot();
        _;
    }

    // ─── Constructor & Initializer ──────────────────────────────────────────────

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice Initializes the Router proxy.
    /// @param _reputationRegistry Address of the ERC-8004 ReputationRegistry.
    /// @param _identityRegistry Address of the ERC-8004 IdentityRegistry.
    /// @param _klerosAgentId The agentId registered for Kleros on the IdentityRegistry.
    /// @param _owner Address that will own this Router (can manage bots, upgrade).
    function initialize(address _reputationRegistry, address _identityRegistry, uint256 _klerosAgentId, address _owner)
        external
        initializer
    {
        __Ownable_init(_owner);
        reputationRegistry = IReputationRegistry(_reputationRegistry);
        identityRegistry = IIdentityRegistry(_identityRegistry);
        klerosAgentId = _klerosAgentId;
    }

    // ─── Feedback Functions ─────────────────────────────────────────────────────

    /// @notice Scenario 1: Submit positive feedback for an agent (verified on PGTCR).
    /// @dev Accepts FeedbackType.None or FeedbackType.Negative (re-registration after dispute).
    ///      Reverts if agent already has positive feedback.
    /// @param agentId The ERC-8004 agent identifier.
    /// @param pgtcrItemId The PGTCR item ID (for event indexing).
    /// @param feedbackURI IPFS URI for the evidence JSON.
    function submitPositiveFeedback(uint256 agentId, bytes32 pgtcrItemId, string calldata feedbackURI)
        external
        onlyAuthorizedBot
    {
        FeedbackType currentType = feedbackType[agentId];
        if (currentType == FeedbackType.Positive) revert KRR_AlreadyHasPositiveFeedback(agentId);

        reputationRegistry.giveFeedback(
            agentId, POSITIVE_VALUE, VALUE_DECIMALS, TAG_VERIFIED, TAG_REGISTRY, "", feedbackURI, bytes32(0)
        );

        uint64 idx = reputationRegistry.getLastIndex(agentId, address(this));
        feedbackIndex[agentId] = idx;
        feedbackType[agentId] = FeedbackType.Positive;

        emit PositiveFeedbackSubmitted(agentId, pgtcrItemId, idx);
    }

    /// @notice Scenario 2: Submit negative feedback for an agent (removed by dispute).
    /// @dev If agent has positive feedback, atomically revokes it first, then submits -95.
    ///      If agent has no prior feedback, just submits -95.
    ///      Reverts if agent already has negative feedback.
    /// @param agentId The ERC-8004 agent identifier.
    /// @param feedbackURI IPFS URI for the evidence JSON.
    function submitNegativeFeedback(uint256 agentId, string calldata feedbackURI) external onlyAuthorizedBot {
        FeedbackType currentType = feedbackType[agentId];

        // Atomic: if positive exists, revoke it first
        if (currentType == FeedbackType.Positive) {
            reputationRegistry.revokeFeedback(agentId, feedbackIndex[agentId]);
        } else if (currentType == FeedbackType.Negative) {
            revert KRR_AlreadyHasNegativeFeedback(agentId);
        }
        // At this point: either was Positive (now revoked) or was None

        reputationRegistry.giveFeedback(
            agentId, NEGATIVE_VALUE, VALUE_DECIMALS, TAG_REMOVED, TAG_REGISTRY, "", feedbackURI, bytes32(0)
        );

        uint64 idx = reputationRegistry.getLastIndex(agentId, address(this));
        feedbackIndex[agentId] = idx;
        feedbackType[agentId] = FeedbackType.Negative;

        emit NegativeFeedbackSubmitted(agentId, idx);
    }

    /// @notice Scenario 3: Revoke positive feedback only (voluntary withdrawal).
    /// @dev Reverts if agent does not have positive feedback.
    /// @param agentId The ERC-8004 agent identifier.
    function revokeOnly(uint256 agentId) external onlyAuthorizedBot {
        if (feedbackType[agentId] != FeedbackType.Positive) revert KRR_NoPositiveFeedbackToRevoke(agentId);

        reputationRegistry.revokeFeedback(agentId, feedbackIndex[agentId]);
        feedbackType[agentId] = FeedbackType.None;
        feedbackIndex[agentId] = 0;

        emit FeedbackRevoked(agentId);
    }

    // ─── Admin Functions ────────────────────────────────────────────────────────

    /// @notice Authorize or deauthorize a bot address.
    /// @param bot The bot address.
    /// @param authorized Whether the bot is authorized.
    function setAuthorizedBot(address bot, bool authorized) external onlyOwner {
        authorizedBots[bot] = authorized;
        emit BotAuthorizationChanged(bot, authorized);
    }

    /// @notice Update the Kleros agent ID.
    /// @param _klerosAgentId The new agent ID.
    function setKlerosAgentId(uint256 _klerosAgentId) external onlyOwner {
        klerosAgentId = _klerosAgentId;
    }

    /// @notice Update the ReputationRegistry address.
    /// @param _reputationRegistry The new ReputationRegistry address.
    function setReputationRegistry(address _reputationRegistry) external onlyOwner {
        reputationRegistry = IReputationRegistry(_reputationRegistry);
    }

    /// @notice Update the IdentityRegistry address.
    /// @param _identityRegistry The new IdentityRegistry address.
    function setIdentityRegistry(address _identityRegistry) external onlyOwner {
        identityRegistry = IIdentityRegistry(_identityRegistry);
    }

    /// @notice Register this Router as an agent on the IdentityRegistry and store the agentId.
    /// @param agentURI URI to agent metadata JSON.
    /// @return agentId The newly registered agent ID.
    function registerAgent(string calldata agentURI) external onlyOwner returns (uint256 agentId) {
        agentId = identityRegistry.register(agentURI);
        klerosAgentId = agentId;
        emit AgentRegistered(agentId, agentURI);
    }

    // ─── UUPS ───────────────────────────────────────────────────────────────────

    /// @dev Only the owner can authorize upgrades.
    function _authorizeUpgrade(address) internal override onlyOwner {}

    // ─── ERC-721 Receiver ──────────────────────────────────────────────────────

    /// @dev Required for IdentityRegistry.register() which uses ERC-721 safeMint.
    function onERC721Received(address, address, uint256, bytes calldata) external pure override returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }

    // ─── Storage Gap ────────────────────────────────────────────────────────────

    uint256[50] private __gap;
}
