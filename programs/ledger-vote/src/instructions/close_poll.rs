use anchor_lang::prelude::*;

use crate::{
    constants::*,
    error::ErrorCode,
    state::{Config, Poll},
};

#[derive(Accounts)]
pub struct ClosePoll<'info> {
    pub authority: Signer<'info>,
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = authority @ ErrorCode::Unauthorized
    )]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        seeds = [POLL_SEED, &poll.id.to_le_bytes()],
        bump = poll.bump,
        has_one = authority @ ErrorCode::Unauthorized
    )]
    pub poll: Account<'info, Poll>,
}

pub fn handle_close_poll(ctx: Context<ClosePoll>) -> Result<()> {
    require!(!ctx.accounts.poll.closed, ErrorCode::PollClosed);
    ctx.accounts.poll.closed = true;
    msg!("Poll {} closed", ctx.accounts.poll.id);
    Ok(())
}
