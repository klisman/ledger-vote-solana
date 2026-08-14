use anchor_lang::prelude::*;
use anchor_spl::token_interface::{TokenAccount, TokenInterface};

use crate::{
    constants::*,
    error::ErrorCode,
    state::{Config, Poll, VoteReceipt},
    weight::vote_weight,
};

#[derive(Accounts)]
pub struct CastVote<'info> {
    #[account(mut)]
    pub voter: Signer<'info>,
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump
    )]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        seeds = [POLL_SEED, &poll.id.to_le_bytes()],
        bump = poll.bump
    )]
    pub poll: Account<'info, Poll>,
    #[account(
        associated_token::mint = config.vote_mint,
        associated_token::authority = voter,
        associated_token::token_program = token_program
    )]
    pub voter_ata: InterfaceAccount<'info, TokenAccount>,
    #[account(
        init,
        payer = voter,
        space = 8 + VoteReceipt::INIT_SPACE,
        seeds = [VOTE_SEED, poll.key().as_ref(), voter.key().as_ref()],
        bump
    )]
    pub vote_receipt: Account<'info, VoteReceipt>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn handle_cast_vote(ctx: Context<CastVote>, choice: u8) -> Result<()> {
    let poll = &mut ctx.accounts.poll;
    require!(!poll.closed, ErrorCode::PollClosed);

    let now = Clock::get()?.unix_timestamp;
    require!(
        now >= poll.start_ts && now <= poll.end_ts,
        ErrorCode::PollNotOpen
    );
    require!(choice < poll.option_count, ErrorCode::InvalidChoice);

    let weight = vote_weight(ctx.accounts.voter_ata.amount)?;

    let idx = choice as usize;
    poll.tallies[idx] = poll.tallies[idx]
        .checked_add(weight)
        .ok_or(ErrorCode::TallyOverflow)?;

    let receipt = &mut ctx.accounts.vote_receipt;
    receipt.poll = poll.key();
    receipt.voter = ctx.accounts.voter.key();
    receipt.choice = choice;
    receipt.weight = weight;
    receipt.bump = ctx.bumps.vote_receipt;

    msg!("Voted {} with weight {}", choice, weight);
    Ok(())
}
