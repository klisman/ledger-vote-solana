use {
    litesvm::LiteSVM, solana_account::Account, solana_keypair::Keypair,
    solana_program_option::COption, solana_program_pack::Pack, solana_signer::Signer,
};

use super::harness::{initialize_ix, insert_mint, send_ix};
use super::poll::{config_pda, create_poll_ix, poll_pda, set_clock, TEST_NOW};
use anchor_lang::{
    prelude::Pubkey, solana_program::instruction::Instruction, AccountDeserialize,
    AccountSerialize, InstructionData, ToAccountMetas,
};
use spl_associated_token_account_interface::address::get_associated_token_address_with_program_id;
use spl_token_interface::{
    state::{Account as SplTokenAccount, AccountState},
    ID as TOKEN_PROGRAM_ID,
};

pub const TOKEN_2022_PROGRAM_ID: Pubkey =
    Pubkey::from_str_const("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

pub fn vote_pda(program_id: &Pubkey, poll: &Pubkey, voter: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[
            ledger_vote::constants::VOTE_SEED,
            poll.as_ref(),
            voter.as_ref(),
        ],
        program_id,
    )
}

pub fn ata_address(owner: &Pubkey, mint: &Pubkey, token_program: &Pubkey) -> Pubkey {
    get_associated_token_address_with_program_id(owner, mint, token_program)
}

pub fn insert_token_account(
    svm: &mut LiteSVM,
    address: Pubkey,
    owner: Pubkey,
    mint: Pubkey,
    token_program: Pubkey,
    amount: u64,
) {
    let token_acc = SplTokenAccount {
        mint,
        owner,
        amount,
        delegate: COption::None,
        state: AccountState::Initialized,
        is_native: COption::None,
        delegated_amount: 0,
        close_authority: COption::None,
    };
    let mut data = vec![0u8; SplTokenAccount::LEN];
    SplTokenAccount::pack(token_acc, &mut data).unwrap();
    svm.set_account(
        address,
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

pub fn insert_ata(
    svm: &mut LiteSVM,
    owner: Pubkey,
    mint: Pubkey,
    token_program: Pubkey,
    amount: u64,
) -> Pubkey {
    let ata = ata_address(&owner, &mint, &token_program);
    insert_token_account(svm, ata, owner, mint, token_program, amount);
    ata
}

pub fn set_ata_amount(svm: &mut LiteSVM, ata: Pubkey, amount: u64) {
    let acc = svm.get_account(&ata).unwrap();
    let mut token = SplTokenAccount::unpack(&acc.data).unwrap();
    token.amount = amount;
    let mut data = acc.data;
    SplTokenAccount::pack(token, &mut data).unwrap();
    svm.set_account(
        ata,
        Account {
            lamports: acc.lamports,
            data,
            owner: acc.owner,
            executable: acc.executable,
            rent_epoch: acc.rent_epoch,
        },
    )
    .unwrap();
}

pub fn set_poll_closed(svm: &mut LiteSVM, poll: Pubkey) {
    let acc = svm.get_account(&poll).unwrap();
    let mut data: &[u8] = &acc.data;
    let mut state = ledger_vote::state::Poll::try_deserialize(&mut data).unwrap();
    state.closed = true;
    let mut out = Vec::new();
    state.try_serialize(&mut out).unwrap();
    svm.set_account(
        poll,
        Account {
            lamports: acc.lamports,
            data: out,
            owner: acc.owner,
            executable: acc.executable,
            rent_epoch: acc.rent_epoch,
        },
    )
    .unwrap();
}

pub fn initialized_with_token_program(
    svm: &mut LiteSVM,
    program_id: &Pubkey,
    payer: &Keypair,
    token_program: Pubkey,
) -> (Pubkey, Pubkey) {
    svm.airdrop(&payer.pubkey(), 1_000_000_000).unwrap();
    let vote_mint = Pubkey::new_unique();
    insert_mint(svm, vote_mint, payer.pubkey(), token_program);
    let (config, _) = config_pda(program_id);
    send_ix(
        svm,
        payer,
        initialize_ix(payer.pubkey(), config, vote_mint, token_program),
    )
    .unwrap();
    set_clock(svm, TEST_NOW);
    (config, vote_mint)
}

pub fn open_poll(
    svm: &mut LiteSVM,
    program_id: &Pubkey,
    authority: &Keypair,
    config: Pubkey,
) -> Pubkey {
    let (poll, _) = poll_pda(program_id, 0);
    send_ix(
        svm,
        authority,
        create_poll_ix(
            authority.pubkey(),
            config,
            poll,
            "best color".into(),
            vec!["yes".into(), "no".into()],
            TEST_NOW,
            TEST_NOW + 3_600,
        ),
    )
    .unwrap();
    poll
}

pub fn cast_vote_ix(
    voter: Pubkey,
    config: Pubkey,
    poll: Pubkey,
    voter_ata: Pubkey,
    vote_receipt: Pubkey,
    token_program: Pubkey,
    choice: u8,
) -> Instruction {
    Instruction::new_with_bytes(
        ledger_vote::id(),
        &ledger_vote::instruction::CastVote { choice }.data(),
        ledger_vote::accounts::CastVote {
            voter,
            config,
            poll,
            voter_ata,
            vote_receipt,
            token_program,
            system_program: anchor_lang::solana_program::system_program::ID,
        }
        .to_account_metas(None),
    )
}

pub fn send_vote(
    svm: &mut LiteSVM,
    voter: &Keypair,
    config: Pubkey,
    poll: Pubkey,
    voter_ata: Pubkey,
    vote_receipt: Pubkey,
    token_program: Pubkey,
    choice: u8,
) -> litesvm::types::TransactionResult {
    send_ix(
        svm,
        voter,
        cast_vote_ix(
            voter.pubkey(),
            config,
            poll,
            voter_ata,
            vote_receipt,
            token_program,
            choice,
        ),
    )
}

pub fn classic_token_program() -> Pubkey {
    TOKEN_PROGRAM_ID
}
