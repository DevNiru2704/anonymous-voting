# Anonymous Voting dApp on Stellar Testnet

This is a complete, working full-stack decentralized application built on the Stellar network using Soroban. It implements a private voting system using a commit-reveal scheme. In the commit phase, voters submit a hash of their vote and a secret phrase. In the reveal phase, they submit the actual vote and secret to be verified and tallied. No vote is visible on-chain until the reveal phase ends.

## Tech Stack
-   **Smart Contract**: Rust / Soroban SDK (v21.0.0)
-   **Frontend**: Next.js 14 (App Router), TypeScript, Tailwind CSS
-   **Stellar Integration**: Stellar SDK, Freighter API
-   **Network**: Stellar Testnet

## Prerequisites
- Rust installed: `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
- Wasm target: `rustup target add wasm32-unknown-unknown`
- Stellar CLI: `cargo install --locked stellar-cli --features opt`
- Node.js 18+
- Freighter wallet browser extension installed from https://freighter.app

## Project Structure
- `/contracts`: Soroban smart contract source code and tests.
  - `/src/lib.rs`: The main Soroban Rust smart contract implementation.
  - `Cargo.toml`: Rust dependencies and configuration.
- `/frontend`: Next.js 14 web application.
  - `/app`: Next.js App Router pages and layouts.
  - `/components`: UI components like `WalletConnect` and `MainFeature`.
  - `/lib`: Helper functions for Stellar and Soroban RPC interactions.

## Step 1 — Build the Smart Contract
```bash
cd contracts
cargo build --target wasm32-unknown-unknown --release
```
This command compiles your Rust code into a WebAssembly (.wasm) file located at `contracts/target/wasm32-unknown-unknown/release/anonymous_voting.wasm`.

## Step 2 — Set Up a Testnet Identity
```bash
stellar keys generate --global my-key --network testnet
stellar keys address my-key
```
This creates a keypair for deployment and automatically funds it with Testnet XLM via Friendbot.

## Step 3 — Deploy Contract to Testnet
```bash
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/anonymous_voting.wasm \
  --source my-key \
  --network testnet
```
Copy the 56-character Contract ID returned. You'll need it for the frontend environment.

## Step 4 — Install Frontend Dependencies
```bash
cd ../frontend
npm install
```

## Step 5 — Configure Environment Variables
```bash
cp .env.example .env.local
```
Open `.env.local` and paste the Contract ID from Step 3 into `NEXT_PUBLIC_CONTRACT_ID`.

## Step 6 — Run the Frontend
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000)

## Step 7 — Using the App
- Install Freighter at https://freighter.app and set it to Testnet mode.
- Click "Connect Wallet" to link your Freighter wallet.
- Click "Get Testnet XLM" to fund your wallet via Friendbot if needed.
- First user initializes the poll: specify options, commit duration (seconds), and reveal duration.
- Commit phase: Select an option and enter a "secret". Save this secret!
- Reveal phase (after commit duration): Enter your choice and the same secret to register your vote.

## Smart Contract Functions
- `init`: Sets the admin, vote options, and durations for commit and reveal phases. (Write)
- `commit`: Submits a SHA-256 hash commitment of a vote and a user secret. (Write)
- `reveal`: Takes the actual vote and secret, hashes them, compares against the commitment, and increments the tally. (Write)
- `get_votes`: Returns the current vote count for a given option. (Read)
- `get_state`: Retrieves the current metadata around the vote (active phases, options, etc.). (Read)

## Common Errors & Fixes
-   **"Transaction simulation failed"** → contract not deployed or wrong CONTRACT_ID in .env.local
-   **"Freighter not found"** → install the Freighter extension and refresh
-   **"Account not found"** → click "Get Testnet XLM" to fund your wallet first
-   **"wasm32 target not found"** → run: `rustup target add wasm32-unknown-unknown`

## Testnet Resources
-   Stellar Testnet Explorer: https://stellar.expert/explorer/testnet
-   Stellar Lab (manual transactions): https://lab.stellar.org
-   Friendbot: https://friendbot.stellar.org/?addr=YOUR_PUBLIC_KEY
