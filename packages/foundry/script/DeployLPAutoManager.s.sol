// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./DeployHelpers.s.sol";
import {LPAutoManager} from "../contracts/LPAutoManager.sol";

/// @notice Deploy script for LPAutoManager on Base mainnet.
/// @dev Inherits ScaffoldETHDeploy which provides the `deployer` variable and the
///      `ScaffoldEthDeployerRunner` modifier (broadcast + ABI export).
///
///      Deployer-first ownership pattern:
///        1. Constructor sets `deployer` as the initial owner.
///        2. Deployer calls `transferOwnership(CLIENT)` to nominate the client.
///        3. The client must call `acceptOwnership()` from their wallet to take control
///           (Ownable2Step). This is intentional and prevents misdirected ownership.
///
///      Run examples:
///        yarn deploy --file DeployLPAutoManager.s.sol --network base
contract DeployLPAutoManager is ScaffoldETHDeploy {
    // --- Base mainnet addresses ---
    address internal constant POSITION_MANAGER = 0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1;
    address internal constant WETH = 0x4200000000000000000000000000000000000006;
    address internal constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    uint24 internal constant POOL_FEE = 500;

    // --- Client (final owner after acceptOwnership) ---
    address internal constant CLIENT = 0xE226c3D455BE157c544AD62Fda8D0728f12c3A5D;

    function run() external ScaffoldEthDeployerRunner {
        // 1. Deploy with the deployer as initial owner so we can perform any pre-handover setup.
        LPAutoManager manager = new LPAutoManager(POSITION_MANAGER, WETH, USDC, POOL_FEE, deployer);

        // 2. Initiate ownership handover. CLIENT must call acceptOwnership() to finalize.
        manager.transferOwnership(CLIENT);
    }
}
