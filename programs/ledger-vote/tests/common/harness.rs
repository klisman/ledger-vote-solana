use {
    litesvm::LiteSVM,
    solana_account::Account,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_program_option::COption,
    solana_program_pack::Pack,
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
    spl_token_interface::state::Mint,
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

pub fn insert_mint(svm: &mut LiteSVM, mint: Pubkey, mint_authority: Pubkey, token_program: Pubkey) {
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
            owner: token_program,
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

pub fn initialize_ix(
    payer: Pubkey,
    config: Pubkey,
    vote_mint: Pubkey,
    token_program: Pubkey,
) -> Instruction {
    Instruction::new_with_bytes(
        ledger_vote::id(),
        &ledger_vote::instruction::Initialize {}.data(),
        ledger_vote::accounts::Initialize {
            payer,
            config,
            vote_mint,
            token_program,
            system_program: anchor_lang::solana_program::system_program::ID,
        }
        .to_account_metas(None),
    )
}
