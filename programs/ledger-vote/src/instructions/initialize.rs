use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenInterface};

use crate::{constants::*, error::ErrorCode, state::Config};

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
    #[account(
        constraint = *vote_mint.to_account_info().owner == token_program.key()
            @ ErrorCode::MintTokenProgramMismatch
    )]
    pub vote_mint: InterfaceAccount<'info, Mint>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn handle_initialize(ctx: Context<Initialize>) -> Result<()> {
    require!(
        ctx.accounts.vote_mint.freeze_authority
            == Some(ctx.accounts.config.key()).into(),
        ErrorCode::MintFreezeRequired
    );
    ctx.accounts.config.authority = ctx.accounts.payer.key();
    ctx.accounts.config.vote_mint = ctx.accounts.vote_mint.key();
    ctx.accounts.config.poll_count = 0;
    ctx.accounts.config.bump = ctx.bumps.config;
    msg!("Config initialized");
    Ok(())
}
