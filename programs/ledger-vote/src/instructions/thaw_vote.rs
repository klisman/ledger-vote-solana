use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    thaw_account, Mint, ThawAccount, TokenAccount, TokenInterface,
};

use crate::{
    constants::*,
    error::ErrorCode,
    state::{Config, Poll, VoteReceipt},
};

#[derive(Accounts)]
pub struct ThawVote<'info> {
    pub voter: Signer<'info>,
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump
    )]
    pub config: Account<'info, Config>,
    #[account(
        seeds = [POLL_SEED, &poll.id.to_le_bytes()],
        bump = poll.bump
    )]
    pub poll: Account<'info, Poll>,
    #[account(
        address = config.vote_mint,
        constraint = *vote_mint.to_account_info().owner == token_program.key()
            @ ErrorCode::MintTokenProgramMismatch
    )]
    pub vote_mint: InterfaceAccount<'info, Mint>,
    #[account(
        mut,
        associated_token::mint = vote_mint,
        associated_token::authority = voter,
        associated_token::token_program = token_program
    )]
    pub voter_ata: InterfaceAccount<'info, TokenAccount>,
    #[account(
        seeds = [VOTE_SEED, poll.key().as_ref(), voter.key().as_ref()],
        bump = vote_receipt.bump,
        has_one = poll,
        has_one = voter
    )]
    pub vote_receipt: Account<'info, VoteReceipt>,
    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handle_thaw_vote(ctx: Context<ThawVote>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require!(
        ctx.accounts.poll.closed || now > ctx.accounts.poll.end_ts,
        ErrorCode::PollStillOpen
    );
    require!(
        ctx.accounts.voter_ata.is_frozen(),
        ErrorCode::AccountNotFrozen
    );

    let seeds: &[&[u8]] = &[CONFIG_SEED, &[ctx.accounts.config.bump]];
    thaw_account(CpiContext::new_with_signer(
        ctx.accounts.token_program.key(),
        ThawAccount {
            account: ctx.accounts.voter_ata.to_account_info(),
            mint: ctx.accounts.vote_mint.to_account_info(),
            authority: ctx.accounts.config.to_account_info(),
        },
        &[seeds],
    ))?;

    msg!("Thawed voter ATA for poll {}", ctx.accounts.poll.id);
    Ok(())
}
