pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;
pub mod weight;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;
pub use weight::*;

declare_id!("5VQzLw5d2hJeTUVBhWqDGoUSy8neABguNHTBgrJFUper");

#[program]
pub mod ledger_vote {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        crate::instructions::initialize::handle_initialize(ctx)
    }

    pub fn create_poll(
        ctx: Context<CreatePoll>,
        question: String,
        options: Vec<String>,
        start_ts: i64,
        end_ts: i64,
    ) -> Result<()> {
        crate::instructions::create_poll::handle_create_poll(
            ctx, question, options, start_ts, end_ts,
        )
    }

    pub fn cast_vote(ctx: Context<CastVote>, choice: u8) -> Result<()> {
        crate::instructions::cast_vote::handle_cast_vote(ctx, choice)
    }
}
