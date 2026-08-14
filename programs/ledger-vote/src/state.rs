use anchor_lang::prelude::*;

use crate::constants::{MAX_OPTIONS, MAX_OPTION_LEN, MAX_QUESTION_LEN};

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub authority: Pubkey,
    pub vote_mint: Pubkey,
    pub poll_count: u64,
    pub bump: u8,
}

/// Poll question, options, voting window, and tallies.
#[account]
#[derive(InitSpace)]
pub struct Poll {
    pub id: u64,
    pub authority: Pubkey,
    pub bump: u8,
    pub question: [u8; MAX_QUESTION_LEN],
    pub options: [[u8; MAX_OPTION_LEN]; MAX_OPTIONS as usize],
    pub option_count: u8,
    pub start_ts: i64,
    pub end_ts: i64,
    pub closed: bool,
    pub tallies: [u64; MAX_OPTIONS as usize],
}

/// One receipt per (poll, voter). `weight` is `floor(sqrt(ATA amount))` at `cast_vote`.
#[account]
#[derive(InitSpace)]
pub struct VoteReceipt {
    pub poll: Pubkey,
    pub voter: Pubkey,
    pub choice: u8,
    pub weight: u64,
    pub bump: u8,
}
