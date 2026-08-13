use {
    litesvm::LiteSVM,
    solana_account::Account,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_program_option::COption,
    solana_program_pack::Pack,
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
    spl_token_interface::{state::Mint, ID as TOKEN_PROGRAM_ID},
};

use anchor_lang::{
    prelude::Pubkey, solana_program::instruction::Instruction, InstructionData, ToAccountMetas,
};

pub fn program_bytes() -> &'static [u8] {
    include_bytes!(concat!(
        env!("CARGO_TARGET_TMPDIR"),
        "/../deploy/ledger_vote.so"
    ))
}

pub fn setup_svm() -> (LiteSVM, Pubkey) {
    let program_id = ledger_vote::id();
    let mut svm = LiteSVM::new();
    svm.add_program(program_id, program_bytes()).unwrap();
    (svm, program_id)
}

pub fn insert_mint(svm: &mut LiteSVM, mint: Pubkey, mint_authority: Pubkey) {
    let mint_state = Mint {
        mint_authority: COption::Some(mint_authority),
        supply: 0,
        decimals: 6,
        is_initialized: true,
        freeze_authority: COption::None,
    };
    let mut data = vec![0u8; Mint::LEN];
    Mint::pack(mint_state, &mut data).unwrap();
    svm.set_account(
        mint,
        Account {
            lamports: 1_000_000_000,
            data,
            owner: TOKEN_PROGRAM_ID,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();
}

pub fn send_ix(
    svm: &mut LiteSVM,
    payer: &Keypair,
    instruction: Instruction,
) -> litesvm::types::TransactionResult {
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[instruction], Some(&payer.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[payer]).unwrap();
    svm.send_transaction(tx)
}

pub fn initialize_ix(payer: Pubkey, config: Pubkey, vote_mint: Pubkey) -> Instruction {
    Instruction::new_with_bytes(
        ledger_vote::id(),
        &ledger_vote::instruction::Initialize {}.data(),
        ledger_vote::accounts::Initialize {
            payer,
            config,
            vote_mint,
            token_program: TOKEN_PROGRAM_ID,
            system_program: anchor_lang::solana_program::system_program::ID,
        }
        .to_account_metas(None),
    )
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

/// Fund a payer, insert a mint, initialize Config, and pin the clock.
pub fn initialized(svm: &mut LiteSVM, program_id: &Pubkey, payer: &Keypair) -> (Pubkey, Pubkey) {
    svm.airdrop(&payer.pubkey(), 1_000_000_000).unwrap();
    let vote_mint = Pubkey::new_unique();
    insert_mint(svm, vote_mint, payer.pubkey());
    let (config, _) = config_pda(program_id);
    send_ix(svm, payer, initialize_ix(payer.pubkey(), config, vote_mint)).unwrap();
    set_clock(svm, TEST_NOW);
    (config, vote_mint)
}
