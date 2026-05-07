// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Minimal interface for the Uniswap V3 NonfungiblePositionManager.
/// @dev Only the methods used by LPAutoManager are declared here.
interface INonfungiblePositionManager {
    struct MintParams {
        address token0;
        address token1;
        uint24 fee;
        int24 tickLower;
        int24 tickUpper;
        uint256 amount0Desired;
        uint256 amount1Desired;
        uint256 amount0Min;
        uint256 amount1Min;
        address recipient;
        uint256 deadline;
    }

    struct IncreaseLiquidityParams {
        uint256 tokenId;
        uint256 amount0Desired;
        uint256 amount1Desired;
        uint256 amount0Min;
        uint256 amount1Min;
        uint256 deadline;
    }

    struct DecreaseLiquidityParams {
        uint256 tokenId;
        uint128 liquidity;
        uint256 amount0Min;
        uint256 amount1Min;
        uint256 deadline;
    }

    struct CollectParams {
        uint256 tokenId;
        address recipient;
        uint128 amount0Max;
        uint128 amount1Max;
    }

    function mint(MintParams calldata params)
        external
        payable
        returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1);

    function increaseLiquidity(IncreaseLiquidityParams calldata params)
        external
        payable
        returns (uint128 liquidity, uint256 amount0, uint256 amount1);

    function decreaseLiquidity(DecreaseLiquidityParams calldata params)
        external
        payable
        returns (uint256 amount0, uint256 amount1);

    function collect(CollectParams calldata params) external payable returns (uint256 amount0, uint256 amount1);

    function positions(uint256 tokenId)
        external
        view
        returns (
            uint96 nonce,
            address operator,
            address token0,
            address token1,
            uint24 fee,
            int24 tickLower,
            int24 tickUpper,
            uint128 liquidity,
            uint256 feeGrowthInside0LastX128,
            uint256 feeGrowthInside1LastX128,
            uint128 tokensOwed0,
            uint128 tokensOwed1
        );

    function burn(uint256 tokenId) external payable;
}

/// @title LPAutoManager
/// @notice Manages a single Uniswap V3 concentrated liquidity position (token0/token1 at a fixed fee tier)
///         and tokenizes proportional ownership of its liquidity as ERC20 shares.
/// @dev    Designed for the WETH/USDC 0.05% pool on Base, but the contract is parameterized so it can
///         be deployed against any Uniswap V3 pair as long as token0 < token1 ordering is respected by the caller.
contract LPAutoManager is ERC20, Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // --- Immutable configuration ---

    /// @notice Uniswap V3 NonfungiblePositionManager.
    INonfungiblePositionManager public immutable positionManager;
    /// @notice Lower-address pool token (e.g. WETH on Base).
    IERC20 public immutable token0;
    /// @notice Higher-address pool token (e.g. USDC on Base).
    IERC20 public immutable token1;
    /// @notice Pool fee tier (e.g. 500 = 0.05%).
    uint24 public immutable fee;

    // --- Position state ---

    /// @notice Token ID of the active Uniswap V3 position. Zero before initialize().
    uint256 public tokenId;
    /// @notice Lower tick of the active position.
    int24 public tickLower;
    /// @notice Upper tick of the active position.
    int24 public tickUpper;

    // --- Events ---

    event Initialized(uint256 tokenId, int24 tickLower, int24 tickUpper);
    event Deposited(address indexed user, uint256 amount0Used, uint256 amount1Used, uint256 shares);
    event Withdrawn(address indexed user, uint256 amount0, uint256 amount1, uint256 shares);
    event FeesCollected(uint256 amount0Fees, uint256 amount1Fees);
    event Rebalanced(int24 oldTickLower, int24 oldTickUpper, int24 newTickLower, int24 newTickUpper);

    // --- Errors ---

    error AlreadyInitialized();
    error NotInitialized();
    error ZeroLiquidity();
    error ZeroShares();
    error InvalidTickRange();

    constructor(
        address _positionManager,
        address _token0,
        address _token1,
        uint24 _fee,
        address _owner
    ) ERC20("LP Auto Manager Share", "LPAMS") Ownable(_owner) {
        require(_positionManager != address(0), "positionManager=0");
        require(_token0 != address(0) && _token1 != address(0), "token=0");
        require(_token0 < _token1, "token order");

        positionManager = INonfungiblePositionManager(_positionManager);
        token0 = IERC20(_token0);
        token1 = IERC20(_token1);
        fee = _fee;
    }

    // --- View helpers ---

    /// @notice Returns the current liquidity held by the active Uniswap V3 position.
    /// @return liquidity Liquidity units currently deployed in the position; 0 if not initialized.
    function positionLiquidity() public view returns (uint128 liquidity) {
        uint256 _tokenId = tokenId;
        if (_tokenId == 0) return 0;
        (, , , , , , , liquidity, , , , ) = positionManager.positions(_tokenId);
    }

    // --- Owner: initialize ---

    /// @notice Creates the initial Uniswap V3 position. Owner-only and one-shot.
    /// @dev Pulls token0/token1 from `msg.sender` (the owner). Mints shares 1:1 with the liquidity minted.
    /// @param _tickLower Lower tick of the new position.
    /// @param _tickUpper Upper tick of the new position.
    /// @param amount0 Maximum amount of token0 to spend.
    /// @param amount1 Maximum amount of token1 to spend.
    function initialize(int24 _tickLower, int24 _tickUpper, uint256 amount0, uint256 amount1)
        external
        onlyOwner
        nonReentrant
    {
        if (tokenId != 0) revert AlreadyInitialized();
        if (_tickLower >= _tickUpper) revert InvalidTickRange();

        // Effects: capture intended ticks before external interactions.
        tickLower = _tickLower;
        tickUpper = _tickUpper;

        // Pull funds from the caller and approve the position manager.
        if (amount0 > 0) token0.safeTransferFrom(msg.sender, address(this), amount0);
        if (amount1 > 0) token1.safeTransferFrom(msg.sender, address(this), amount1);
        token0.forceApprove(address(positionManager), amount0);
        token1.forceApprove(address(positionManager), amount1);

        INonfungiblePositionManager.MintParams memory params = INonfungiblePositionManager.MintParams({
            token0: address(token0),
            token1: address(token1),
            fee: fee,
            tickLower: _tickLower,
            tickUpper: _tickUpper,
            amount0Desired: amount0,
            amount1Desired: amount1,
            amount0Min: 0,
            amount1Min: 0,
            recipient: address(this),
            deadline: block.timestamp
        });

        (uint256 newTokenId, uint128 liquidity, uint256 used0, uint256 used1) = positionManager.mint(params);
        if (liquidity == 0) revert ZeroLiquidity();

        tokenId = newTokenId;

        // Revoke residual allowance.
        token0.forceApprove(address(positionManager), 0);
        token1.forceApprove(address(positionManager), 0);

        // Refund any unspent tokens to the owner.
        if (used0 < amount0) token0.safeTransfer(msg.sender, amount0 - used0);
        if (used1 < amount1) token1.safeTransfer(msg.sender, amount1 - used1);

        // Initial shares: 1:1 with liquidity units.
        _mint(msg.sender, liquidity);

        emit Initialized(newTokenId, _tickLower, _tickUpper);
        emit Deposited(msg.sender, used0, used1, liquidity);
    }

    // --- Public: deposit ---

    /// @notice Deposits token0/token1 into the active position and mints proportional shares.
    /// @dev Shares are minted in proportion to liquidity added vs. liquidity that existed before the increase.
    ///      Slippage protection is intentionally lax (mins = 0); callers should set their own input limits and
    ///      observe pool state immediately before calling.
    /// @param amount0Desired Maximum token0 to spend.
    /// @param amount1Desired Maximum token1 to spend.
    /// @return shares Shares minted to the caller.
    /// @return used0 Token0 actually consumed by the position.
    /// @return used1 Token1 actually consumed by the position.
    function deposit(uint256 amount0Desired, uint256 amount1Desired)
        external
        nonReentrant
        returns (uint256 shares, uint256 used0, uint256 used1)
    {
        uint256 _tokenId = tokenId;
        if (_tokenId == 0) revert NotInitialized();

        // Capture liquidity BEFORE the increase so the share math is correct.
        uint128 liquidityBefore = positionLiquidity();

        // Pull funds from the caller and approve the position manager.
        if (amount0Desired > 0) token0.safeTransferFrom(msg.sender, address(this), amount0Desired);
        if (amount1Desired > 0) token1.safeTransferFrom(msg.sender, address(this), amount1Desired);
        token0.forceApprove(address(positionManager), amount0Desired);
        token1.forceApprove(address(positionManager), amount1Desired);

        INonfungiblePositionManager.IncreaseLiquidityParams memory params = INonfungiblePositionManager
            .IncreaseLiquidityParams({
            tokenId: _tokenId,
            amount0Desired: amount0Desired,
            amount1Desired: amount1Desired,
            amount0Min: 0,
            amount1Min: 0,
            deadline: block.timestamp
        });

        uint128 liquidityAdded;
        (liquidityAdded, used0, used1) = positionManager.increaseLiquidity(params);
        if (liquidityAdded == 0) revert ZeroLiquidity();

        // Revoke residual allowance.
        token0.forceApprove(address(positionManager), 0);
        token1.forceApprove(address(positionManager), 0);

        // Refund any unspent tokens to the depositor.
        if (used0 < amount0Desired) token0.safeTransfer(msg.sender, amount0Desired - used0);
        if (used1 < amount1Desired) token1.safeTransfer(msg.sender, amount1Desired - used1);

        // Share math: shares = liquidityAdded * totalShares / liquidityBefore.
        // liquidityBefore is guaranteed > 0 because tokenId != 0 implies a prior initialize()
        // that minted with non-zero liquidity, and shares cannot exist if liquidity is zero.
        uint256 _totalSupply = totalSupply();
        if (_totalSupply == 0 || liquidityBefore == 0) {
            // Fallback path (defensive): treat as a fresh seed of the pool.
            shares = liquidityAdded;
        } else {
            shares = (uint256(liquidityAdded) * _totalSupply) / uint256(liquidityBefore);
        }
        if (shares == 0) revert ZeroShares();

        _mint(msg.sender, shares);

        emit Deposited(msg.sender, used0, used1, shares);
    }

    // --- Public: withdraw ---

    /// @notice Burns shares and returns the proportional share of token0/token1 from the position.
    /// @dev Also collects any tokens owed (including fees attributable to the redeemed liquidity)
    ///      and forwards the proportional slice to the redeemer.
    /// @param shares Amount of LPAMS shares to burn.
    /// @return amount0 Token0 sent to the caller.
    /// @return amount1 Token1 sent to the caller.
    function withdraw(uint256 shares) external nonReentrant returns (uint256 amount0, uint256 amount1) {
        if (shares == 0) revert ZeroShares();
        uint256 _tokenId = tokenId;
        if (_tokenId == 0) revert NotInitialized();

        uint256 _totalSupply = totalSupply();
        uint128 liquidity = positionLiquidity();

        // liquidityToRemove = shares * liquidity / totalSupply.
        // Bounded above by `liquidity` (uint128), so the cast below cannot truncate.
        uint256 liquidityToRemove = (uint256(liquidity) * shares) / _totalSupply;
        if (liquidityToRemove == 0) revert ZeroLiquidity();

        // Effects: burn shares before external calls.
        _burn(msg.sender, shares);

        // Decrease liquidity; tokens become "owed" on the position and are pulled in via collect().
        // liquidityToRemove is bounded above by `liquidity` (uint128), so the cast cannot truncate.
        INonfungiblePositionManager.DecreaseLiquidityParams memory dparams = INonfungiblePositionManager
            .DecreaseLiquidityParams({
            tokenId: _tokenId,
            // forge-lint: disable-next-line(unsafe-typecast)
            liquidity: uint128(liquidityToRemove),
            amount0Min: 0,
            amount1Min: 0,
            deadline: block.timestamp
        });
        positionManager.decreaseLiquidity(dparams);

        // Collect: principal portion + the redeemer's pro-rata slice of any uncollected fees.
        // We collect only `shares / totalSupply` of total tokensOwed so remaining holders keep their fees.
        (uint128 owed0, uint128 owed1) = _tokensOwed(_tokenId);
        uint256 collect0 = (uint256(owed0) * shares) / _totalSupply;
        uint256 collect1 = (uint256(owed1) * shares) / _totalSupply;

        if (collect0 > type(uint128).max) collect0 = type(uint128).max;
        if (collect1 > type(uint128).max) collect1 = type(uint128).max;

        // Both values are clamped to <= type(uint128).max above, so the casts are safe.
        (amount0, amount1) = positionManager.collect(
            INonfungiblePositionManager.CollectParams({
                tokenId: _tokenId,
                recipient: address(this),
                // forge-lint: disable-next-line(unsafe-typecast)
                amount0Max: uint128(collect0),
                // forge-lint: disable-next-line(unsafe-typecast)
                amount1Max: uint128(collect1)
            })
        );

        // Forward to the redeemer.
        if (amount0 > 0) token0.safeTransfer(msg.sender, amount0);
        if (amount1 > 0) token1.safeTransfer(msg.sender, amount1);

        emit Withdrawn(msg.sender, amount0, amount1, shares);
    }

    // --- Public: collect & reinvest ---

    /// @notice Collects accrued fees from the position and re-deposits them (auto-compound).
    /// @dev    Permissionless: anyone can pay gas to compound. The contract retains any leftover (un-paired)
    ///         token amounts for the next compound. No new shares are minted; existing holders accrue value.
    /// @return collected0 Amount of token0 collected as fees.
    /// @return collected1 Amount of token1 collected as fees.
    function collectAndReinvest() external nonReentrant returns (uint256 collected0, uint256 collected1) {
        uint256 _tokenId = tokenId;
        if (_tokenId == 0) revert NotInitialized();

        // Step 1: collect everything that is currently owed (i.e. accrued fees).
        (collected0, collected1) = positionManager.collect(
            INonfungiblePositionManager.CollectParams({
                tokenId: _tokenId,
                recipient: address(this),
                amount0Max: type(uint128).max,
                amount1Max: type(uint128).max
            })
        );

        emit FeesCollected(collected0, collected1);

        // Step 2: reinvest using whatever token0/token1 the contract holds (sweep idle balances too).
        uint256 bal0 = token0.balanceOf(address(this));
        uint256 bal1 = token1.balanceOf(address(this));
        if (bal0 == 0 && bal1 == 0) return (collected0, collected1);

        token0.forceApprove(address(positionManager), bal0);
        token1.forceApprove(address(positionManager), bal1);

        INonfungiblePositionManager.IncreaseLiquidityParams memory params = INonfungiblePositionManager
            .IncreaseLiquidityParams({
            tokenId: _tokenId,
            amount0Desired: bal0,
            amount1Desired: bal1,
            amount0Min: 0,
            amount1Min: 0,
            deadline: block.timestamp
        });

        // The increaseLiquidity call may revert if the position can't accept any liquidity (e.g. only one-sided
        // fees collected and price is at a range bound). In that case we skip silently and leave the fees parked.
        try positionManager.increaseLiquidity(params) returns (uint128, uint256, uint256) {
            // success
        } catch {
            // leave idle balances for next compound
        }

        token0.forceApprove(address(positionManager), 0);
        token1.forceApprove(address(positionManager), 0);
    }

    // --- Owner: rebalance ---

    /// @notice Removes all liquidity and fees from the current position, burns its NFT, and mints a new
    ///         position at a different tick range. Owner-only.
    /// @dev The owner must observe pool state immediately before calling and pass meaningful slippage mins.
    /// @param newTickLower Lower tick of the new position.
    /// @param newTickUpper Upper tick of the new position.
    /// @param amount0Min Minimum token0 redeemed from the old position (slippage protection).
    /// @param amount1Min Minimum token1 redeemed from the old position (slippage protection).
    function rebalance(int24 newTickLower, int24 newTickUpper, uint256 amount0Min, uint256 amount1Min)
        external
        onlyOwner
        nonReentrant
    {
        uint256 oldTokenId = tokenId;
        if (oldTokenId == 0) revert NotInitialized();
        if (newTickLower >= newTickUpper) revert InvalidTickRange();

        int24 oldTickLower = tickLower;
        int24 oldTickUpper = tickUpper;

        // 1. Remove all liquidity from the old position.
        uint128 liquidity = positionLiquidity();
        if (liquidity > 0) {
            positionManager.decreaseLiquidity(
                INonfungiblePositionManager.DecreaseLiquidityParams({
                    tokenId: oldTokenId,
                    liquidity: liquidity,
                    amount0Min: amount0Min,
                    amount1Min: amount1Min,
                    deadline: block.timestamp
                })
            );
        }

        // 2. Collect everything owed (principal + fees) into this contract.
        positionManager.collect(
            INonfungiblePositionManager.CollectParams({
                tokenId: oldTokenId,
                recipient: address(this),
                amount0Max: type(uint128).max,
                amount1Max: type(uint128).max
            })
        );

        // 3. Burn the now-empty position NFT.
        positionManager.burn(oldTokenId);

        // 4. Mint a new position with whatever balances we have.
        uint256 bal0 = token0.balanceOf(address(this));
        uint256 bal1 = token1.balanceOf(address(this));

        token0.forceApprove(address(positionManager), bal0);
        token1.forceApprove(address(positionManager), bal1);

        (uint256 newTokenId, uint128 newLiquidity, , ) = positionManager.mint(
            INonfungiblePositionManager.MintParams({
                token0: address(token0),
                token1: address(token1),
                fee: fee,
                tickLower: newTickLower,
                tickUpper: newTickUpper,
                amount0Desired: bal0,
                amount1Desired: bal1,
                amount0Min: 0,
                amount1Min: 0,
                recipient: address(this),
                deadline: block.timestamp
            })
        );
        if (newLiquidity == 0) revert ZeroLiquidity();

        token0.forceApprove(address(positionManager), 0);
        token1.forceApprove(address(positionManager), 0);

        // 5. Update state. Total share supply is unchanged: holders' claim now maps onto the new position's liquidity.
        tokenId = newTokenId;
        tickLower = newTickLower;
        tickUpper = newTickUpper;

        emit Rebalanced(oldTickLower, oldTickUpper, newTickLower, newTickUpper);
    }

    // --- Internal helpers ---

    function _tokensOwed(uint256 _tokenId) internal view returns (uint128 owed0, uint128 owed1) {
        (, , , , , , , , , , owed0, owed1) = positionManager.positions(_tokenId);
    }
}
