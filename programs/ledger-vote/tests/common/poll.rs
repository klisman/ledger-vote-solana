use {
    litesvm::types::TransactionResult, litesvm::LiteSVM,
    solana_instruction::error::InstructionError, solana_keypair::Keypair, solana_signer::Signer,
    solana_transaction_error::TransactionError,
};

use super::harness::{initialize_ix, insert_mint, send_ix};
use anchor_lang::{
    prelude::Pubkey, solana_program::instruction::Instruction, InstructionData, ToAccountMetas,
};
use ledger_vote::error::ErrorCode;
use spl_token_interface::ID as TOKEN_PROGRAM_ID;

pub fn assert_anchor_error(res: TransactionResult, expected: ErrorCode) {
    let failed = match res {
        Err(e) => e,
        Ok(meta) => panic!("expected {expected:?}, transaction succeeded: {meta:?}"),
    };
    let expected_code = u32::from(expected);
    match failed.err {
        TransactionError::InstructionError(_, InstructionError::Custom(code)) => {
            assert_eq!(
                code,
                expected_code,
                "expected {expected:?} ({expected_code}), got Custom({code}); logs:\n{}",
                failed.meta.logs.join("\n")
            );
        }
        other => panic!(
            "expected {expected:?} ({expected_code}), got {other:?}; logs:\n{}",
            failed.meta.logs.join("\n")
        ),
    }
}

pub fn assert_instruction_failed_with_log(res: TransactionResult, needle: &str) {
    let failed = match res {
        Err(e) => e,
        Ok(meta) => {
            panic!("expected failure containing {needle:?}, transaction succeeded: {meta:?}")
        }
    };
    match failed.err {
        TransactionError::InstructionError(_, _) => {}
        other => panic!(
            "expected InstructionError containing {needle:?}, got {other:?}; logs:\n{}",
            failed.meta.logs.join("\n")
        ),
    }
    let logs = failed.meta.logs.join("\n");
    assert!(
        logs.to_lowercase().contains(&needle.to_lowercase())
            || format!("{:?}", failed.err)
                .to_lowercase()
                .contains(&needle.to_lowercase()),
        "expected {needle:?} in logs or error, got {err:?}; logs:\n{logs}",
        err = failed.err
    );
}

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
    insert_mint(svm, vote_mint, payer.pubkey(), TOKEN_PROGRAM_ID);
    let (config, _) = config_pda(program_id);
    send_ix(
        svm,
        payer,
        initialize_ix(payer.pubkey(), config, vote_mint, TOKEN_PROGRAM_ID),
    )
    .unwrap();
    set_clock(svm, TEST_NOW);
    (config, vote_mint)
}
