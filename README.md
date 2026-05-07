# LP Auto Manager

An automated WETH/USDC liquidity manager for Uniswap V3 on Base. The contract holds a single concentrated-liquidity position (0.05% fee tier) and tokenizes ownership as ERC20 shares (LPAMS). Anyone can permissionlessly trigger fee collection and reinvestment; the owner can rebalance the active tick range.

## Live Contract

- **Network**: Base mainnet (chainId 8453)
- **Address**: [`0x92eb64088e5A291f5f8E837Aa203F01733f479c3`](https://basescan.org/address/0x92eb64088e5A291f5f8E837Aa203F01733f479c3)
- **Token0**: WETH (`0x4200000000000000000000000000000000000006`)
- **Token1**: USDC (`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`)
- **Fee tier**: 500 (0.05%)

## Client / Owner Note

After deployment, ownership of the contract is transferred to the client wallet via the OpenZeppelin two-step `Ownable2Step` pattern. The client wallet **must call `acceptOwnership()`** to become the active owner before any owner-only actions (rebalance, etc.) can be performed.

The current pending owner is the wallet listed by `pendingOwner()` on the contract. Once that wallet connects to this dApp, the owner panel will surface an "Accept Ownership" button.

## Features

- **Deposit**: Supply WETH and/or USDC, receive LPAMS shares proportional to the liquidity added.
- **Withdraw**: Burn LPAMS shares, receive a pro-rata share of the underlying WETH and USDC.
- **Auto-compound**: Anyone can call `collectAndReinvest()` to claim earned fees and re-add them as liquidity.
- **Rebalance** (owner-only): Move the active tick range to track price.

## Run Locally

Requires Node.js (>= v20.18.3), Yarn, and Git.

```bash
# 1. Install dependencies
yarn install

# 2. Start the Next.js frontend
yarn start
```

The app is available at `http://localhost:3000`.

### Static export build

```bash
cd packages/nextjs
NODE_OPTIONS="--require ./polyfill-localstorage.cjs" \
  NEXT_PUBLIC_IPFS_BUILD=true \
  yarn build
```

Output is written to `packages/nextjs/out/`, suitable for hosting on IPFS or any static host.

## Architecture

- `packages/foundry/` — Solidity contracts (`LPAutoManager.sol`)
- `packages/nextjs/` — Next.js App Router frontend with RainbowKit, Wagmi, Viem, DaisyUI

The frontend reads contract data using SE-2 hooks (`useScaffoldReadContract`, `useScaffoldWriteContract`) and supports MetaMask, WalletConnect, Ledger, Coinbase Smart Wallet, Rainbow, Phantom, and Safe.
