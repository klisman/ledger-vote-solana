# Ledger Vote

On-chain vote ledger for Solana. Built with [Anchor](https://www.anchor-lang.com/) and tested in-process with [LiteSVM](https://github.com/LiteSVM/litesvm).

Votes are **square-root token-weighted**: weight is `floor(sqrt(ATA amount))` of the mint on `Config`, snapshotted onto `VoteReceipt` when they vote. More tokens still mean more power, but extra balance buys diminishing tally units so a whale cannot linearly dominate a poll.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Anchor](https://img.shields.io/badge/Anchor-1.1.2-8752F3)](https://www.anchor-lang.com/)
[![Solana](https://img.shields.io/badge/Solana-3.1.10-9945FF)](https://solana.com/)

## What this is

A portfolio Solana program that records polls, votes, and tallies on-chain.

**This PR** adds square-root-weighted `cast_vote`. Anyone with a positive ATA of the Config mint can vote once per poll.

- `initialize` creates `Config` and records the vote mint
- `create_poll` opens a `Poll` PDA at `["poll", poll_id]` where `poll_id = config.poll_count`
- `cast_vote` snapshots `weight = floor(sqrt(ATA amount))` onto a `VoteReceipt` at `["vote", poll, voter]` and adds that to the poll tally
- Rejects closed polls, votes outside the window, out-of-range choices, zero balance, and a second receipt for the same voter
- Token and Token-2022 ATAs both work (`InterfaceAccount` + `TokenInterface`)

## Stack

| Tool | Version |
| --- | --- |
| Anchor | 1.1.2 |
| Solana CLI | 3.1.10 |
| Rust (MSRV) | 1.89.0 |
| LiteSVM | 0.10.x |
| solana crates | ^3 |
| Tokens | SPL Token + Token-2022 (`anchor-spl` interfaces) |

## Architecture

```mermaid
flowchart TD
  authority[Config authority]
  config["Config PDA seeds = config"]
  mint[Vote mint]
  poll["Poll PDA seeds = poll, poll_id"]
  ata[Voter ATA]
  receipt["VoteReceipt PDA seeds = vote, poll, voter"]

  authority -->|initialize| config
  config --> mint
  authority -->|create_poll| poll
  ata -->|cast_vote weight = sqrt amount| receipt
  poll --> receipt
  authority -->|close_poll later| poll
```

| Account | Seeds | Status |
| --- | --- | --- |
| `Config` | `["config"]` | Implemented. Authority, vote mint, sequential `poll_count`. |
| `Poll` | `["poll", poll_id]` | Implemented. Question, 2–4 options, window, tallies. |
| `VoteReceipt` | `["vote", poll, voter]` | Implemented. Choice + `floor(sqrt(ATA amount))` snapshotted at vote. One per voter per poll. |

## Vote weight

Weight is still derived from the vote-mint ATA, but it is **not linear**. `cast_vote` writes:

```text
weight = floor(sqrt(raw_ata_amount))
```

`raw_ata_amount` is the token account’s `amount` field (base units, not UI tokens). A 6-decimal mint with 1 whole token is `1_000_000` raw units → weight `1000`.

| Raw ATA amount | Linear `amount` | This program `floor(sqrt(amount))` |
| --- | ---: | ---: |
| 1 | 1 | 1 |
| 100 | 100 | 10 |
| 1,000,000 | 1,000,000 | 1,000 |
| 1,000,000,000,000 | 1,000,000,000,000 | 1,000,000 |

A whale with 1,000,000 raw units has **1,000×** a holder with 1 unit, not 1,000,000×. Extra tokens still help, but each doubling of balance adds less voting power than linear weighting.

| Rule | Value |
| --- | --- |
| Who can vote | Signer whose canonical ATA of `Config.vote_mint` has `amount > 0` |
| Weight written to `VoteReceipt` | `floor(sqrt(amount))` (`vote_weight` in `weight.rs`) |
| When it is frozen | At `cast_vote`. Moving tokens afterward does not change the receipt |
| One snapshot per wallet | `VoteReceipt` PDA `["vote", poll, voter]` is `init` — a second vote fails |

`Poll.tallies[i]` is the **sum of square-root weights** for wallets that chose option `i`.

Splitting tokens across wallets can raise *total* sqrt weight (100 wallets of 1 → 100, vs one wallet of 100 → 10). Each extra wallet still needs SOL rent, an ATA, and a signature. That is the usual sybil tradeoff of per-wallet damping without an identity system.

## Project layout

```text
.
├── Anchor.toml
├── Cargo.toml
├── programs/ledger-vote/
│   ├── src/
│   │   ├── lib.rs
│   │   ├── constants.rs
│   │   ├── error.rs
│   │   ├── state.rs
│   │   ├── weight.rs
│   │   └── instructions/
│   └── tests/
│       ├── common/harness.rs
│       ├── common/poll.rs
│       ├── common/vote.rs
│       ├── test_initialize.rs
│       ├── test_create_poll.rs
│       └── test_cast_vote.rs
```

## Prerequisites

- Rust 1.89.0 (`rust-toolchain.toml` pins this)
- Solana CLI 3.1.10
- Anchor CLI 1.1.2 (`avm install 1.1.2 && avm use 1.1.2`)

## Build and test

```bash
NO_DNA=1 anchor build
NO_DNA=1 cargo test
```

`anchor test` is wired to `cargo test`. Tests run LiteSVM in-process; no local validator is required.

## Security notes

- Prefer typed `Account<'info, T>` / `InterfaceAccount` over `UncheckedAccount`
- Derive PDAs with canonical seeds and store/verify bumps
- Check signers and `has_one` / `constraint` for authority
- Do not use `init_if_needed` (reinitialization risk)
- Keep program keypairs out of git

## Roadmap

Sequential PRs. Each is its own branch; merge before starting the next.

| # | Work | Branch | Status |
| --- | --- | --- | --- |
| 1 | Scaffold — workspace, `Config`, LiteSVM | `feat/01-scaffold` | Merged ([#2](https://github.com/klisman/ledger-vote-solana/pull/2)) |
| 2 | Domain accounts + vote mint on `initialize` | `feat/02-accounts-and-mint` | Merged ([#3](https://github.com/klisman/ledger-vote-solana/pull/3)) |
| 3 | `create_poll` | `feat/03-create-poll` | Merged ([#4](https://github.com/klisman/ledger-vote-solana/pull/4)) |
| 4 | `cast_vote` — square-root token weight, one `VoteReceipt` per voter | `feat/04-cast-vote` | **This PR** ([#5](https://github.com/klisman/ledger-vote-solana/pull/5)) |
| 5 | `close_poll` — authority locks the poll; later votes fail | `feat/05-close-poll` | Next, after #5 merges |
| 6 | Minimal web UI — Next.js + Kit wallet | `feat/06-web-ui` | After `close_poll` |

`cast_vote` weight is `floor(sqrt(raw ATA amount))`, snapshotted on the receipt. Linear `weight = amount` is out: extra tokens still add power, with diminishing returns so a whale cannot linearly dominate.

## License

MIT. See [LICENSE](LICENSE).
