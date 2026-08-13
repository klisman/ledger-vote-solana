use anchor_lang::prelude::*;

#[constant]
pub const CONFIG_SEED: &[u8] = b"config";

#[constant]
pub const POLL_SEED: &[u8] = b"poll";

#[constant]
pub const VOTE_SEED: &[u8] = b"vote";

#[constant]
pub const MAX_OPTIONS: u8 = 4;

#[constant]
pub const MIN_OPTIONS: u8 = 2;

pub const MAX_QUESTION_LEN: usize = 64;
pub const MAX_OPTION_LEN: usize = 32;
