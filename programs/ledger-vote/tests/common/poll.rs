use {litesvm::LiteSVM, solana_keypair::Keypair, solana_signer::Signer};

use super::harness::{initialize_ix, insert_mint, send_ix};
use anchor_lang::{
    prelude::Pubkey, solana_program::instruction::Instruction, InstructionData, ToAccountMetas,
};

pub fn create_poll_ix(
    authority: Pubkey,
    config: Pubkey,
    poll: Pubkey,
    question: String,
    options: Vec<String>,
    start_ts: i64,
    end_ts: i64,
) -> Instruction {
    Instruction::new_with_bytes(
        ledger_vote::id(),
        &ledger_vote::instruction::CreatePoll {
            question,
            options,
            start_ts,
            end_ts,
        }
        .data(),
        ledger_vote::accounts::CreatePoll {
            authority,
            config,
            poll,
            system_program: anchor_lang::solana_program::system_program::ID,
        }
        .to_account_metas(None),
    )
}

pub fn poll_pda(program_id: &Pubkey, poll_id: u64) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[ledger_vote::constants::POLL_SEED, &poll_id.to_le_bytes()],
        program_id,
    )
}

pub fn config_pda(program_id: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[ledger_vote::constants::CONFIG_SEED], program_id)
}

pub const TEST_NOW: i64 = 1_700_000_000;

pub fn set_clock(svm: &mut LiteSVM, unix_timestamp: i64) {
    svm.set_sysvar(&solana_clock::Clock {
        unix_timestamp,
        ..solana_clock::Clock::default()
    });
}

pub fn initialized(svm: &mut LiteSVM, program_id: &Pubkey, payer: &Keypair) -> (Pubkey, Pubkey) {
    svm.airdrop(&payer.pubkey(), 1_000_000_000).unwrap();
    let vote_mint = Pubkey::new_unique();
    insert_mint(svm, vote_mint, payer.pubkey());
    let (config, _) = config_pda(program_id);
    send_ix(svm, payer, initialize_ix(payer.pubkey(), config, vote_mint)).unwrap();
    set_clock(svm, TEST_NOW);
    (config, vote_mint)
}
