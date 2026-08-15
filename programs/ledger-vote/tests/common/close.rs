use {litesvm::LiteSVM, solana_keypair::Keypair, solana_signer::Signer};

use super::harness::send_ix;
use anchor_lang::{
    prelude::Pubkey, solana_program::instruction::Instruction, InstructionData, ToAccountMetas,
};

pub fn close_poll_ix(authority: Pubkey, config: Pubkey, poll: Pubkey) -> Instruction {
    Instruction::new_with_bytes(
        ledger_vote::id(),
        &ledger_vote::instruction::ClosePoll {}.data(),
        ledger_vote::accounts::ClosePoll {
            authority,
            config,
            poll,
        }
        .to_account_metas(None),
    )
}

pub fn send_close(
    svm: &mut LiteSVM,
    authority: &Keypair,
    config: Pubkey,
    poll: Pubkey,
) -> litesvm::types::TransactionResult {
    send_ix(
        svm,
        authority,
        close_poll_ix(authority.pubkey(), config, poll),
    )
}
