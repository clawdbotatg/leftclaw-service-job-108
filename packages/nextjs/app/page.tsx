"use client";

import { useEffect, useMemo, useState } from "react";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { Address } from "@scaffold-ui/components";
import type { NextPage } from "next";
import { formatEther, formatUnits, parseEther, parseUnits } from "viem";
import { base } from "viem/chains";
import { useAccount, useSwitchChain } from "wagmi";
import { useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import { useWriteAndOpen } from "~~/hooks/scaffold-eth/useWriteAndOpen";
import { notification } from "~~/utils/scaffold-eth";

const CONTRACT_ADDRESS = "0x92eb64088e5A291f5f8E837Aa203F01733f479c3" as const;

const SLIPPAGE_OPTIONS = [0.5, 1, 2] as const;
const DEFAULT_SLIPPAGE = 1;

const formatBig = (value: bigint | undefined, decimals: number, fractionDigits = 6): string => {
  if (value === undefined) return "—";
  try {
    const formatted = decimals === 18 ? formatEther(value) : formatUnits(value, decimals);
    const num = Number(formatted);
    if (!Number.isFinite(num)) return formatted;
    return num.toLocaleString(undefined, { maximumFractionDigits: fractionDigits });
  } catch {
    return value.toString();
  }
};

const safeParseUnits = (value: string, decimals: number): bigint => {
  if (!value) return 0n;
  try {
    return parseUnits(value, decimals);
  } catch {
    return 0n;
  }
};

const safeParseInt = (value: string): number | undefined => {
  if (value === "" || value === "-") return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) return undefined;
  return parsed;
};

const applySlippage = (amount: bigint, slippagePct: number): bigint => {
  if (amount === 0n) return 0n;
  // multiply by (100 - slippagePct) using basis-points-of-percent precision
  const numerator = BigInt(Math.floor((100 - slippagePct) * 100));
  return (amount * numerator) / 10000n;
};

const getDeadline = (): bigint => BigInt(Math.floor(Date.now() / 1000) + 30 * 60);

// ─── Slippage Selector ────────────────────────────────────────────────────────

type SlippageSelectorProps = {
  slippage: number;
  setSlippage: (s: number) => void;
};

const SlippageSelector = ({ slippage, setSlippage }: SlippageSelectorProps) => {
  const [customMode, setCustomMode] = useState(false);
  return (
    <div>
      <label className="label">
        <span className="label-text font-medium">Slippage tolerance</span>
        <span className="label-text-alt font-mono">{slippage}%</span>
      </label>
      <div className="flex flex-wrap gap-2">
        {SLIPPAGE_OPTIONS.map(opt => (
          <button
            key={opt}
            type="button"
            className={`btn btn-sm ${!customMode && slippage === opt ? "btn-primary" : "btn-outline"}`}
            onClick={() => {
              setCustomMode(false);
              setSlippage(opt);
            }}
          >
            {opt}%
          </button>
        ))}
        <button
          type="button"
          className={`btn btn-sm ${customMode ? "btn-primary" : "btn-outline"}`}
          onClick={() => setCustomMode(true)}
        >
          Custom
        </button>
        {customMode && (
          <input
            type="number"
            min="0"
            step="0.1"
            value={slippage}
            onChange={e => setSlippage(Number(e.target.value) || 0)}
            className="input input-bordered input-sm w-24"
            placeholder="%"
          />
        )}
      </div>
    </div>
  );
};

// ─── Position Info Card (Section 1) ──────────────────────────────────────────

const PositionInfoCard = () => {
  const { data: tokenId } = useScaffoldReadContract({
    contractName: "LPAutoManager",
    functionName: "tokenId",
  });
  const { data: tickLower } = useScaffoldReadContract({
    contractName: "LPAutoManager",
    functionName: "tickLower",
  });
  const { data: tickUpper } = useScaffoldReadContract({
    contractName: "LPAutoManager",
    functionName: "tickUpper",
  });
  const { data: positionLiquidity } = useScaffoldReadContract({
    contractName: "LPAutoManager",
    functionName: "positionLiquidity",
  });
  const { data: totalSupply } = useScaffoldReadContract({
    contractName: "LPAutoManager",
    functionName: "totalSupply",
  });
  const { data: feeData } = useScaffoldReadContract({
    contractName: "LPAutoManager",
    functionName: "fee",
  });

  const isInitialized = tokenId !== undefined && tokenId > 0n;
  const feePercent = feeData !== undefined ? `${(Number(feeData) / 10000).toFixed(2)}%` : "—";

  return (
    <div className="card bg-base-100 shadow-md">
      <div className="card-body">
        <h3 className="card-title text-base">Position Info</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-base-content/60 mb-0.5">Contract</p>
            <Address address={CONTRACT_ADDRESS} format="short" size="sm" />
          </div>
          <div>
            <p className="text-base-content/60 mb-0.5">Status</p>
            <span className={`badge ${isInitialized ? "badge-success" : "badge-warning"}`}>
              {isInitialized ? `Token #${tokenId.toString()}` : "Not initialized"}
            </span>
          </div>
          <div>
            <p className="text-base-content/60 mb-0.5">Tick Lower</p>
            <span className="font-mono">{tickLower !== undefined ? tickLower.toString() : "—"}</span>
          </div>
          <div>
            <p className="text-base-content/60 mb-0.5">Tick Upper</p>
            <span className="font-mono">{tickUpper !== undefined ? tickUpper.toString() : "—"}</span>
          </div>
          <div>
            <p className="text-base-content/60 mb-0.5">Position Liquidity</p>
            <span className="font-mono">{positionLiquidity !== undefined ? positionLiquidity.toString() : "—"}</span>
          </div>
          <div>
            <p className="text-base-content/60 mb-0.5">Fee Tier</p>
            <span className="font-mono">{feePercent}</span>
          </div>
          <div className="sm:col-span-2">
            <p className="text-base-content/60 mb-0.5">Total LPAMS Shares</p>
            <span className="font-mono">{formatBig(totalSupply, 18, 6)}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── User Position Card (Section 2) ──────────────────────────────────────────

const UserPositionCard = () => {
  const { address } = useAccount();

  const { data: lpamsBalance } = useScaffoldReadContract({
    contractName: "LPAutoManager",
    functionName: "balanceOf",
    args: [address],
    query: { enabled: !!address },
  });
  const { data: wethBalance } = useScaffoldReadContract({
    contractName: "WETH",
    functionName: "balanceOf",
    args: [address],
    query: { enabled: !!address },
  });
  const { data: usdcBalance } = useScaffoldReadContract({
    contractName: "USDC",
    functionName: "balanceOf",
    args: [address],
    query: { enabled: !!address },
  });
  const { data: wethAllowance } = useScaffoldReadContract({
    contractName: "WETH",
    functionName: "allowance",
    args: [address, CONTRACT_ADDRESS],
    query: { enabled: !!address },
  });
  const { data: usdcAllowance } = useScaffoldReadContract({
    contractName: "USDC",
    functionName: "allowance",
    args: [address, CONTRACT_ADDRESS],
    query: { enabled: !!address },
  });

  if (!address) {
    return (
      <div className="card bg-base-100 shadow-md">
        <div className="card-body">
          <h3 className="card-title text-base">Your Position</h3>
          <p className="text-sm text-base-content/70">Connect your wallet to view balances.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="card bg-base-100 shadow-md">
      <div className="card-body">
        <h3 className="card-title text-base">Your Position</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <div className="sm:col-span-2">
            <p className="text-base-content/60 mb-0.5">LPAMS Shares</p>
            <span className="font-mono">{formatBig(lpamsBalance, 18, 6)}</span>
          </div>
          <div>
            <p className="text-base-content/60 mb-0.5">WETH Balance</p>
            <span className="font-mono">{formatBig(wethBalance, 18, 6)}</span>
            <p className="text-xs text-base-content/50 mt-0.5">≈ ETH price</p>
          </div>
          <div>
            <p className="text-base-content/60 mb-0.5">USDC Balance</p>
            <span className="font-mono">{formatBig(usdcBalance, 6, 2)}</span>
            <p className="text-xs text-base-content/50 mt-0.5">≈ $1 each</p>
          </div>
          <div>
            <p className="text-base-content/60 mb-0.5">WETH Allowance</p>
            <span className="font-mono">{formatBig(wethAllowance, 18, 6)}</span>
          </div>
          <div>
            <p className="text-base-content/60 mb-0.5">USDC Allowance</p>
            <span className="font-mono">{formatBig(usdcAllowance, 6, 2)}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── Deposit Panel (Section 3) ───────────────────────────────────────────────

const DepositPanel = () => {
  const { address, isConnected, chainId } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { switchChain } = useSwitchChain();
  const { writeAndOpen } = useWriteAndOpen();

  const [wethAmount, setWethAmount] = useState("");
  const [usdcAmount, setUsdcAmount] = useState("");
  const [slippage, setSlippage] = useState<number>(DEFAULT_SLIPPAGE);

  const [wethApprovalSubmitting, setWethApprovalSubmitting] = useState(false);
  const [wethApproveCooldown, setWethApproveCooldown] = useState(false);
  const [usdcApprovalSubmitting, setUsdcApprovalSubmitting] = useState(false);
  const [usdcApproveCooldown, setUsdcApproveCooldown] = useState(false);

  const wethAmountParsed = useMemo(() => safeParseUnits(wethAmount, 18), [wethAmount]);
  const usdcAmountParsed = useMemo(() => safeParseUnits(usdcAmount, 6), [usdcAmount]);

  const { data: wethAllowance } = useScaffoldReadContract({
    contractName: "WETH",
    functionName: "allowance",
    args: [address, CONTRACT_ADDRESS],
    query: { enabled: !!address },
  });
  const { data: usdcAllowance } = useScaffoldReadContract({
    contractName: "USDC",
    functionName: "allowance",
    args: [address, CONTRACT_ADDRESS],
    query: { enabled: !!address },
  });

  const { writeContractAsync: writeWeth, isPending: isWethPending } = useScaffoldWriteContract({
    contractName: "WETH",
  });
  const { writeContractAsync: writeUsdc, isPending: isUsdcPending } = useScaffoldWriteContract({
    contractName: "USDC",
  });
  const { writeContractAsync: writeLp, isPending: isDepositPending } = useScaffoldWriteContract({
    contractName: "LPAutoManager",
  });

  const needsWethApproval = wethAmountParsed > 0n && (wethAllowance ?? 0n) < wethAmountParsed;
  const needsUsdcApproval = usdcAmountParsed > 0n && (usdcAllowance ?? 0n) < usdcAmountParsed;

  const handleApproveWeth = async () => {
    if (wethApprovalSubmitting || wethApproveCooldown) return;
    setWethApprovalSubmitting(true);
    try {
      await writeAndOpen(() =>
        writeWeth({
          functionName: "approve",
          args: [CONTRACT_ADDRESS, wethAmountParsed],
        }),
      );
      setWethApproveCooldown(true);
      setTimeout(() => setWethApproveCooldown(false), 3000);
      notification.success("WETH approved");
    } catch (err) {
      console.error(err);
      notification.error("WETH approval failed");
    } finally {
      setWethApprovalSubmitting(false);
    }
  };

  const handleApproveUsdc = async () => {
    if (usdcApprovalSubmitting || usdcApproveCooldown) return;
    setUsdcApprovalSubmitting(true);
    try {
      await writeAndOpen(() =>
        writeUsdc({
          functionName: "approve",
          args: [CONTRACT_ADDRESS, usdcAmountParsed],
        }),
      );
      setUsdcApproveCooldown(true);
      setTimeout(() => setUsdcApproveCooldown(false), 3000);
      notification.success("USDC approved");
    } catch (err) {
      console.error(err);
      notification.error("USDC approval failed");
    } finally {
      setUsdcApprovalSubmitting(false);
    }
  };

  const handleDeposit = async () => {
    if (wethAmountParsed === 0n && usdcAmountParsed === 0n) {
      notification.error("Enter an amount to deposit");
      return;
    }
    try {
      const amount0Min = applySlippage(wethAmountParsed, slippage);
      const amount1Min = applySlippage(usdcAmountParsed, slippage);
      const deadline = getDeadline();
      await writeAndOpen(() =>
        writeLp({
          functionName: "deposit",
          args: [wethAmountParsed, usdcAmountParsed, amount0Min, amount1Min, deadline] as any,
        }),
      );
      notification.success("Deposit submitted");
      setWethAmount("");
      setUsdcAmount("");
    } catch (err) {
      console.error(err);
      notification.error("Deposit failed");
    }
  };

  const renderActionButton = () => {
    if (!isConnected) {
      return (
        <button className="btn btn-primary w-full" onClick={() => openConnectModal?.()}>
          Connect Wallet
        </button>
      );
    }
    if (chainId !== base.id) {
      return (
        <button className="btn btn-warning w-full" onClick={() => switchChain({ chainId: base.id })}>
          Switch to Base
        </button>
      );
    }
    if (needsWethApproval) {
      const loading = wethApprovalSubmitting || isWethPending || wethApproveCooldown;
      return (
        <button className="btn btn-secondary w-full" onClick={handleApproveWeth} disabled={loading}>
          {loading && <span className="loading loading-spinner loading-sm" />}
          {loading ? "Approving WETH…" : "Approve WETH"}
        </button>
      );
    }
    if (needsUsdcApproval) {
      const loading = usdcApprovalSubmitting || isUsdcPending || usdcApproveCooldown;
      return (
        <button className="btn btn-secondary w-full" onClick={handleApproveUsdc} disabled={loading}>
          {loading && <span className="loading loading-spinner loading-sm" />}
          {loading ? "Approving USDC…" : "Approve USDC"}
        </button>
      );
    }
    const canDeposit = wethAmountParsed > 0n || usdcAmountParsed > 0n;
    return (
      <button className="btn btn-primary w-full" onClick={handleDeposit} disabled={isDepositPending || !canDeposit}>
        {isDepositPending && <span className="loading loading-spinner loading-sm" />}
        {isDepositPending ? "Depositing…" : "Deposit"}
      </button>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <label className="label">
          <span className="label-text font-medium">WETH Amount</span>
          <span className="label-text-alt text-base-content/60">18 decimals · ≈ ETH price</span>
        </label>
        <div className="relative">
          <input
            type="number"
            min="0"
            step="any"
            placeholder="0.0"
            value={wethAmount}
            onChange={e => setWethAmount(e.target.value)}
            className="input input-bordered w-full pr-16"
          />
          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-base-content/60 pointer-events-none">
            WETH
          </span>
        </div>
      </div>
      <div>
        <label className="label">
          <span className="label-text font-medium">USDC Amount</span>
          <span className="label-text-alt text-base-content/60">6 decimals · ≈ $1 each</span>
        </label>
        <div className="relative">
          <input
            type="number"
            min="0"
            step="0.000001"
            placeholder="0.00"
            value={usdcAmount}
            onChange={e => setUsdcAmount(e.target.value)}
            className="input input-bordered w-full pr-16"
          />
          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-base-content/60 pointer-events-none">
            USDC
          </span>
        </div>
      </div>
      <SlippageSelector slippage={slippage} setSlippage={setSlippage} />
      <p className="text-xs text-base-content/60">
        Estimated shares: proportional to liquidity added. Deadline auto-set to ~30 min from now.
      </p>
      {renderActionButton()}
    </div>
  );
};

// ─── Withdraw Panel (Section 4) ──────────────────────────────────────────────

const WithdrawPanel = () => {
  const { address, isConnected, chainId } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { switchChain } = useSwitchChain();
  const { writeAndOpen } = useWriteAndOpen();

  const [sharesInput, setSharesInput] = useState("");
  const [slippage, setSlippage] = useState<number>(DEFAULT_SLIPPAGE);

  const { data: userShares } = useScaffoldReadContract({
    contractName: "LPAutoManager",
    functionName: "balanceOf",
    args: [address],
    query: { enabled: !!address },
  });

  const { writeContractAsync: writeLp, isPending } = useScaffoldWriteContract({
    contractName: "LPAutoManager",
  });

  const sharesParsed = useMemo(() => {
    if (!sharesInput) return 0n;
    try {
      return parseEther(sharesInput);
    } catch {
      return 0n;
    }
  }, [sharesInput]);

  const handleWithdraw = async () => {
    if (sharesParsed === 0n) {
      notification.error("Enter shares to withdraw");
      return;
    }
    try {
      await writeAndOpen(() =>
        writeLp({
          functionName: "withdraw",
          args: [sharesParsed, 0n, 0n, getDeadline()] as any,
        }),
      );
      notification.success("Withdraw submitted");
      setSharesInput("");
    } catch (err) {
      console.error(err);
      notification.error("Withdraw failed");
    }
  };

  const handleMax = () => {
    if (userShares !== undefined && userShares > 0n) {
      setSharesInput(formatEther(userShares));
    }
  };

  const renderActionButton = () => {
    if (!isConnected) {
      return (
        <button className="btn btn-primary w-full" onClick={() => openConnectModal?.()}>
          Connect Wallet
        </button>
      );
    }
    if (chainId !== base.id) {
      return (
        <button className="btn btn-warning w-full" onClick={() => switchChain({ chainId: base.id })}>
          Switch to Base
        </button>
      );
    }
    const canWithdraw = sharesParsed > 0n;
    return (
      <button className="btn btn-primary w-full" onClick={handleWithdraw} disabled={isPending || !canWithdraw}>
        {isPending && <span className="loading loading-spinner loading-sm" />}
        {isPending ? "Withdrawing…" : "Withdraw"}
      </button>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      {address && (
        <div className="alert alert-info py-2 flex items-center">
          <span className="text-sm">
            Your shares: <span className="font-mono font-semibold">{formatBig(userShares, 18, 6)}</span>
          </span>
          {userShares !== undefined && userShares > 0n && (
            <button className="btn btn-xs btn-ghost ml-auto" onClick={handleMax}>
              Max
            </button>
          )}
        </div>
      )}
      <div>
        <label className="label">
          <span className="label-text font-medium">Shares to Withdraw</span>
          <span className="label-text-alt text-base-content/60">LPAMS · 18 decimals</span>
        </label>
        <input
          type="number"
          min="0"
          step="any"
          placeholder="0.0"
          value={sharesInput}
          onChange={e => setSharesInput(e.target.value)}
          className="input input-bordered w-full"
        />
      </div>
      <SlippageSelector slippage={slippage} setSlippage={setSlippage} />
      <p className="text-xs text-base-content/60">
        Burn LPAMS shares to receive your share of WETH and USDC. No approval needed for your own shares.
      </p>
      {renderActionButton()}
    </div>
  );
};

// ─── Auto-Compound Section (Section 5) ───────────────────────────────────────

const AutoCompoundSection = () => {
  const { writeAndOpen } = useWriteAndOpen();
  const { writeContractAsync, isPending } = useScaffoldWriteContract({
    contractName: "LPAutoManager",
  });

  const handleCompound = async () => {
    try {
      await writeAndOpen(() =>
        writeContractAsync({
          functionName: "collectAndReinvest",
        }),
      );
      notification.success("Fees collected and reinvested");
    } catch (err) {
      console.error(err);
      notification.error("Compound failed");
    }
  };

  return (
    <div className="card bg-base-100 shadow-md">
      <div className="card-body">
        <h3 className="card-title text-base">Auto-Compound Fees</h3>
        <p className="text-sm text-base-content/70">
          Anyone can trigger fee collection. Earned fees are claimed and reinvested into the active LP position.
        </p>
        <div className="card-actions justify-end mt-2">
          <button className="btn btn-accent" onClick={handleCompound} disabled={isPending}>
            {isPending && <span className="loading loading-spinner loading-sm" />}
            {isPending ? "Compounding…" : "Compound Fees"}
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── Owner Panel (Section 6) ─────────────────────────────────────────────────

const OwnerPanel = () => {
  const { address, isConnected, chainId } = useAccount();
  const { switchChain } = useSwitchChain();
  const { writeAndOpen } = useWriteAndOpen();

  const { data: ownerAddr } = useScaffoldReadContract({
    contractName: "LPAutoManager",
    functionName: "owner",
  });
  const { data: pendingOwnerAddr } = useScaffoldReadContract({
    contractName: "LPAutoManager",
    functionName: "pendingOwner",
  });

  const isOwner = !!address && !!ownerAddr && address.toLowerCase() === ownerAddr.toLowerCase();
  const isPendingOwner = !!address && !!pendingOwnerAddr && address.toLowerCase() === pendingOwnerAddr.toLowerCase();

  const { writeContractAsync, isPending } = useScaffoldWriteContract({
    contractName: "LPAutoManager",
  });

  const [tickLower, setTickLower] = useState("");
  const [tickUpper, setTickUpper] = useState("");
  const [oldAmount0Min, setOldAmount0Min] = useState("");
  const [oldAmount1Min, setOldAmount1Min] = useState("");

  if (!isConnected || (!isOwner && !isPendingOwner)) {
    return null;
  }

  const handleAccept = async () => {
    try {
      await writeAndOpen(() =>
        writeContractAsync({
          functionName: "acceptOwnership",
        }),
      );
      notification.success("Ownership accepted");
    } catch (err) {
      console.error(err);
      notification.error("Accept ownership failed");
    }
  };

  const handleRebalance = async () => {
    const lower = safeParseInt(tickLower);
    const upper = safeParseInt(tickUpper);
    if (lower === undefined || upper === undefined) {
      notification.error("Tick bounds must be integers");
      return;
    }
    if (lower >= upper) {
      notification.error("tickLower must be < tickUpper");
      return;
    }
    if (chainId !== base.id) {
      switchChain({ chainId: base.id });
      return;
    }
    try {
      await writeAndOpen(() =>
        writeContractAsync({
          functionName: "rebalance",
          args: [
            lower,
            upper,
            safeParseUnits(oldAmount0Min, 18),
            safeParseUnits(oldAmount1Min, 6),
            0n,
            0n,
            getDeadline(),
          ] as any,
        }),
      );
      notification.success("Rebalance submitted");
      setTickLower("");
      setTickUpper("");
      setOldAmount0Min("");
      setOldAmount1Min("");
    } catch (err) {
      console.error(err);
      notification.error("Rebalance failed");
    }
  };

  return (
    <div className="card bg-base-100 border-2 border-warning/40 shadow-md">
      <div className="card-body">
        <div className="flex items-center justify-between">
          <h3 className="card-title text-base">Owner Panel</h3>
          <span className="badge badge-warning">{isOwner ? "Owner" : "Pending Owner"}</span>
        </div>

        {isPendingOwner && !isOwner && (
          <div className="alert alert-warning my-2">
            <div className="flex flex-col gap-2 w-full">
              <span className="text-sm">
                You are the pending owner. Accept ownership to take control of this contract.
              </span>
              <button className="btn btn-warning btn-sm" onClick={handleAccept} disabled={isPending}>
                {isPending && <span className="loading loading-spinner loading-sm" />}
                {isPending ? "Accepting…" : "Accept Ownership"}
              </button>
            </div>
          </div>
        )}

        {isOwner && (
          <>
            <div className="divider my-1">Rebalance</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="label">
                  <span className="label-text font-medium">New Tick Lower (int24)</span>
                </label>
                <input
                  type="number"
                  step="1"
                  placeholder="-887220"
                  value={tickLower}
                  onChange={e => setTickLower(e.target.value)}
                  className="input input-bordered w-full"
                />
              </div>
              <div>
                <label className="label">
                  <span className="label-text font-medium">New Tick Upper (int24)</span>
                </label>
                <input
                  type="number"
                  step="1"
                  placeholder="887220"
                  value={tickUpper}
                  onChange={e => setTickUpper(e.target.value)}
                  className="input input-bordered w-full"
                />
              </div>
              <div>
                <label className="label">
                  <span className="label-text font-medium">amount0Min (WETH, 18d)</span>
                </label>
                <input
                  type="number"
                  step="any"
                  placeholder="0.0"
                  value={oldAmount0Min}
                  onChange={e => setOldAmount0Min(e.target.value)}
                  className="input input-bordered w-full"
                />
              </div>
              <div>
                <label className="label">
                  <span className="label-text font-medium">amount1Min (USDC, 6d)</span>
                </label>
                <input
                  type="number"
                  step="any"
                  placeholder="0.0"
                  value={oldAmount1Min}
                  onChange={e => setOldAmount1Min(e.target.value)}
                  className="input input-bordered w-full"
                />
              </div>
            </div>
            <p className="text-xs text-base-content/60 mt-1">
              Tick spacing for the 0.05% pool is 10. Both ticks must be multiples of 10.
            </p>
            <button className="btn btn-warning w-full mt-2" onClick={handleRebalance} disabled={isPending}>
              {isPending && <span className="loading loading-spinner loading-sm" />}
              {isPending ? "Rebalancing…" : "Rebalance"}
            </button>
          </>
        )}
      </div>
    </div>
  );
};

// ─── Main Page ───────────────────────────────────────────────────────────────

const Home: NextPage = () => {
  const [activeTab, setActiveTab] = useState<"deposit" | "withdraw">("deposit");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className="flex flex-col items-center grow pt-8 pb-20">
        <div className="w-full max-w-2xl px-4 flex flex-col gap-6">
          <div className="text-center">
            <h1 className="text-3xl font-bold">LP Auto Manager</h1>
            <p className="text-base-content/70 mt-1">Automated WETH/USDC liquidity on Uniswap V3 · Base</p>
          </div>
          <div className="card bg-base-100 shadow-md">
            <div className="card-body items-center">
              <span className="loading loading-spinner loading-md" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center grow pt-8 pb-20">
      <div className="w-full max-w-2xl px-4 flex flex-col gap-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold">LP Auto Manager</h1>
          <p className="text-base-content/70 mt-1">Automated WETH/USDC liquidity on Uniswap V3 · Base</p>
        </div>

        <PositionInfoCard />
        <UserPositionCard />

        <div className="card bg-base-100 shadow-md">
          <div className="card-body">
            <div className="tabs tabs-boxed mb-4 bg-base-200">
              <button
                className={`tab flex-1 ${activeTab === "deposit" ? "tab-active" : ""}`}
                onClick={() => setActiveTab("deposit")}
              >
                Deposit
              </button>
              <button
                className={`tab flex-1 ${activeTab === "withdraw" ? "tab-active" : ""}`}
                onClick={() => setActiveTab("withdraw")}
              >
                Withdraw
              </button>
            </div>
            {activeTab === "deposit" ? <DepositPanel /> : <WithdrawPanel />}
          </div>
        </div>

        <AutoCompoundSection />
        <OwnerPanel />
      </div>
    </div>
  );
};

export default Home;
