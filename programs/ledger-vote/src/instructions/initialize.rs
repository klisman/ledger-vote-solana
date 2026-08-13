use anchor_lang::prelude::*;

use crate::{constants::*, state::Config};

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        init,
        payer = payer,
        space = 8 + Config::INIT_SPACE,
        seeds = [CONFIG_SEED],
        bump
    )]
    pub config: Account<'info, Config>,
    pub system_program: Program<'info, System>,
}

pub fn handle_initialize(ctx: Context<Initialize>) -> Result<()> {
    ctx.accounts.config.authority = ctx.accounts.payer.key();
    ctx.accounts.config.bump = ctx.bumps.config;
    msg!("Config initialized");
    Ok(())
}
