use anchor_lang::prelude::*;

use crate::{
    constants::*,
    error::ErrorCode,
    state::{Config, Poll},
};

#[derive(Accounts)]
pub struct CreatePoll<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = authority @ ErrorCode::Unauthorized
    )]
    pub config: Account<'info, Config>,
    #[account(
        init,
        payer = authority,
        space = 8 + Poll::INIT_SPACE,
        seeds = [POLL_SEED, &config.poll_count.to_le_bytes()],
        bump
    )]
    pub poll: Account<'info, Poll>,
    pub system_program: Program<'info, System>,
}

pub fn handle_create_poll(
    ctx: Context<CreatePoll>,
    question: String,
    options: Vec<String>,
    start_ts: i64,
    end_ts: i64,
) -> Result<()> {
    require!(
        !question.is_empty() && question.len() <= MAX_QUESTION_LEN,
        ErrorCode::InvalidQuestion
    );
    require!(
        options.len() >= MIN_OPTIONS as usize && options.len() <= MAX_OPTIONS as usize,
        ErrorCode::InvalidOptionCount
    );

    let now = Clock::get()?.unix_timestamp;
    require!(start_ts < end_ts && end_ts > now, ErrorCode::InvalidWindow);

    let mut question_bytes = [0u8; MAX_QUESTION_LEN];
    question_bytes[..question.len()].copy_from_slice(question.as_bytes());

    let mut option_bytes = [[0u8; MAX_OPTION_LEN]; MAX_OPTIONS as usize];
    for (i, option) in options.iter().enumerate() {
        require!(
            !option.is_empty() && option.len() <= MAX_OPTION_LEN,
            ErrorCode::InvalidOption
        );
        option_bytes[i][..option.len()].copy_from_slice(option.as_bytes());
    }

    let poll_id = ctx.accounts.config.poll_count;
    let poll = &mut ctx.accounts.poll;
    poll.id = poll_id;
    poll.authority = ctx.accounts.authority.key();
    poll.bump = ctx.bumps.poll;
    poll.question = question_bytes;
    poll.options = option_bytes;
    poll.option_count = options.len() as u8;
    poll.start_ts = start_ts;
    poll.end_ts = end_ts;
    poll.closed = false;
    poll.tallies = [0; MAX_OPTIONS as usize];

    ctx.accounts.config.poll_count = poll_id.checked_add(1).ok_or(ErrorCode::PollCountOverflow)?;
    msg!("Poll {} created", poll_id);
    Ok(())
}
