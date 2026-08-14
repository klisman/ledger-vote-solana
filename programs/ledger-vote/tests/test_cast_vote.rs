#[path = "common/harness.rs"]
mod harness;
#[path = "common/poll.rs"]
mod poll;
#[path = "common/vote.rs"]
mod vote;

use {
    anchor_lang::{prelude::Pubkey, AccountDeserialize},
    solana_keypair::Keypair,
    solana_signer::Signer,
};

use harness::{insert_mint, send_ix, setup_svm};
use ledger_vote::error::ErrorCode;
use poll::{
    assert_anchor_error, assert_instruction_failed_with_log, create_poll_ix, initialized, poll_pda,
    set_clock, TEST_NOW,
};
use vote::{
    classic_token_program, initialized_with_token_program, insert_ata, insert_token_account,
    open_poll, send_vote, set_ata_amount, set_poll_closed, vote_pda, TOKEN_2022_PROGRAM_ID,
};

fn fund_voter(svm: &mut litesvm::LiteSVM, voter: &Keypair) {
    svm.airdrop(&voter.pubkey(), 1_000_000_000).unwrap();
}

#[test]
fn cast_vote_snapshots_sqrt_weight() {
    let (mut svm, program_id) = setup_svm();
    let authority = Keypair::new();
    let (config, mint) = initialized(&mut svm, &program_id, &authority);
    let poll = open_poll(&mut svm, &program_id, &authority, config);

    let voter = Keypair::new();
    fund_voter(&mut svm, &voter);
    let amount: u64 = 1_000_000;
    let weight = amount.isqrt();
    let ata = insert_ata(
        &mut svm,
        voter.pubkey(),
        mint,
        classic_token_program(),
        amount,
    );
    let (receipt, bump) = vote_pda(&program_id, &poll, &voter.pubkey());

    let res = send_vote(
        &mut svm,
        &voter,
        config,
        poll,
        ata,
        receipt,
        classic_token_program(),
        1,
    );
    assert!(res.is_ok(), "cast_vote failed: {res:?}");

    let mut data: &[u8] = &svm.get_account(&receipt).unwrap().data;
    let receipt_state = ledger_vote::state::VoteReceipt::try_deserialize(&mut data).unwrap();
    assert_eq!(receipt_state.poll, poll);
    assert_eq!(receipt_state.voter, voter.pubkey());
    assert_eq!(receipt_state.choice, 1);
    assert_eq!(receipt_state.weight, weight);
    assert_eq!(receipt_state.bump, bump);

    let mut data: &[u8] = &svm.get_account(&poll).unwrap().data;
    let poll_state = ledger_vote::state::Poll::try_deserialize(&mut data).unwrap();
    assert_eq!(poll_state.tallies, [0, weight, 0, 0]);

    set_ata_amount(&mut svm, ata, 1);
    let mut data: &[u8] = &svm.get_account(&receipt).unwrap().data;
    let receipt_state = ledger_vote::state::VoteReceipt::try_deserialize(&mut data).unwrap();
    assert_eq!(receipt_state.weight, weight);
}

#[test]
fn cast_vote_token_2022() {
    let (mut svm, program_id) = setup_svm();
    let authority = Keypair::new();
    let (config, mint) =
        initialized_with_token_program(&mut svm, &program_id, &authority, TOKEN_2022_PROGRAM_ID);
    let poll = open_poll(&mut svm, &program_id, &authority, config);

    let voter = Keypair::new();
    fund_voter(&mut svm, &voter);
    let ata = insert_ata(&mut svm, voter.pubkey(), mint, TOKEN_2022_PROGRAM_ID, 42);
    let (receipt, _) = vote_pda(&program_id, &poll, &voter.pubkey());

    let res = send_vote(
        &mut svm,
        &voter,
        config,
        poll,
        ata,
        receipt,
        TOKEN_2022_PROGRAM_ID,
        0,
    );
    assert!(res.is_ok(), "token-2022 cast_vote failed: {res:?}");

    let mut data: &[u8] = &svm.get_account(&receipt).unwrap().data;
    let receipt_state = ledger_vote::state::VoteReceipt::try_deserialize(&mut data).unwrap();
    assert_eq!(receipt_state.weight, 42u64.isqrt());
    assert_eq!(receipt_state.choice, 0);
}

#[test]
fn cast_vote_two_voters_accumulate_tallies() {
    let (mut svm, program_id) = setup_svm();
    let authority = Keypair::new();
    let (config, mint) = initialized(&mut svm, &program_id, &authority);
    let poll = open_poll(&mut svm, &program_id, &authority, config);
    let token = classic_token_program();

    let a = Keypair::new();
    let b = Keypair::new();
    fund_voter(&mut svm, &a);
    fund_voter(&mut svm, &b);
    let ata_a = insert_ata(&mut svm, a.pubkey(), mint, token, 10);
    let ata_b = insert_ata(&mut svm, b.pubkey(), mint, token, 25);
    let (receipt_a, _) = vote_pda(&program_id, &poll, &a.pubkey());
    let (receipt_b, _) = vote_pda(&program_id, &poll, &b.pubkey());

    send_vote(&mut svm, &a, config, poll, ata_a, receipt_a, token, 0).unwrap();
    send_vote(&mut svm, &b, config, poll, ata_b, receipt_b, token, 0).unwrap();

    let mut data: &[u8] = &svm.get_account(&poll).unwrap().data;
    let poll_state = ledger_vote::state::Poll::try_deserialize(&mut data).unwrap();
    assert_eq!(poll_state.tallies, [10u64.isqrt() + 25u64.isqrt(), 0, 0, 0]);
}

#[test]
fn cast_vote_whale_weight_is_sqrt_not_linear() {
    let (mut svm, program_id) = setup_svm();
    let authority = Keypair::new();
    let (config, mint) = initialized(&mut svm, &program_id, &authority);
    let poll = open_poll(&mut svm, &program_id, &authority, config);
    let token = classic_token_program();

    let whale = Keypair::new();
    let shrimp = Keypair::new();
    fund_voter(&mut svm, &whale);
    fund_voter(&mut svm, &shrimp);
    let whale_amount: u64 = 1_000_000;
    let shrimp_amount: u64 = 1;
    let ata_whale = insert_ata(&mut svm, whale.pubkey(), mint, token, whale_amount);
    let ata_shrimp = insert_ata(&mut svm, shrimp.pubkey(), mint, token, shrimp_amount);
    let (receipt_whale, _) = vote_pda(&program_id, &poll, &whale.pubkey());
    let (receipt_shrimp, _) = vote_pda(&program_id, &poll, &shrimp.pubkey());

    send_vote(
        &mut svm,
        &whale,
        config,
        poll,
        ata_whale,
        receipt_whale,
        token,
        0,
    )
    .unwrap();
    send_vote(
        &mut svm,
        &shrimp,
        config,
        poll,
        ata_shrimp,
        receipt_shrimp,
        token,
        1,
    )
    .unwrap();

    let mut data: &[u8] = &svm.get_account(&receipt_whale).unwrap().data;
    let whale_receipt = ledger_vote::state::VoteReceipt::try_deserialize(&mut data).unwrap();
    let mut data: &[u8] = &svm.get_account(&receipt_shrimp).unwrap().data;
    let shrimp_receipt = ledger_vote::state::VoteReceipt::try_deserialize(&mut data).unwrap();
    assert_eq!(whale_receipt.weight, whale_amount.isqrt());
    assert_eq!(shrimp_receipt.weight, shrimp_amount.isqrt());
    assert!(whale_receipt.weight > shrimp_receipt.weight);
    assert!(whale_receipt.weight < whale_amount);

    let mut data: &[u8] = &svm.get_account(&poll).unwrap().data;
    let poll_state = ledger_vote::state::Poll::try_deserialize(&mut data).unwrap();
    assert_eq!(
        poll_state.tallies,
        [whale_amount.isqrt(), shrimp_amount.isqrt(), 0, 0]
    );
}

#[test]
fn cast_vote_rejects_zero_weight() {
    let (mut svm, program_id) = setup_svm();
    let authority = Keypair::new();
    let (config, mint) = initialized(&mut svm, &program_id, &authority);
    let poll = open_poll(&mut svm, &program_id, &authority, config);

    let voter = Keypair::new();
    fund_voter(&mut svm, &voter);
    let ata = insert_ata(&mut svm, voter.pubkey(), mint, classic_token_program(), 0);
    let (receipt, _) = vote_pda(&program_id, &poll, &voter.pubkey());

    let res = send_vote(
        &mut svm,
        &voter,
        config,
        poll,
        ata,
        receipt,
        classic_token_program(),
        0,
    );
    assert_anchor_error(res, ErrorCode::ZeroVoteWeight);
}

#[test]
fn cast_vote_rejects_invalid_choice() {
    let (mut svm, program_id) = setup_svm();
    let authority = Keypair::new();
    let (config, mint) = initialized(&mut svm, &program_id, &authority);
    let poll = open_poll(&mut svm, &program_id, &authority, config);

    let voter = Keypair::new();
    fund_voter(&mut svm, &voter);
    let ata = insert_ata(&mut svm, voter.pubkey(), mint, classic_token_program(), 1);
    let (receipt, _) = vote_pda(&program_id, &poll, &voter.pubkey());

    let res = send_vote(
        &mut svm,
        &voter,
        config,
        poll,
        ata,
        receipt,
        classic_token_program(),
        2,
    );
    assert_anchor_error(res, ErrorCode::InvalidChoice);
}

#[test]
fn cast_vote_rejects_before_start() {
    let (mut svm, program_id) = setup_svm();
    let authority = Keypair::new();
    let (config, mint) = initialized(&mut svm, &program_id, &authority);
    let (poll, _) = poll_pda(&program_id, 0);
    send_ix(
        &mut svm,
        &authority,
        create_poll_ix(
            authority.pubkey(),
            config,
            poll,
            "best color".into(),
            vec!["yes".into(), "no".into()],
            TEST_NOW + 60,
            TEST_NOW + 3_600,
        ),
    )
    .unwrap();

    let voter = Keypair::new();
    fund_voter(&mut svm, &voter);
    let ata = insert_ata(&mut svm, voter.pubkey(), mint, classic_token_program(), 1);
    let (receipt, _) = vote_pda(&program_id, &poll, &voter.pubkey());

    let res = send_vote(
        &mut svm,
        &voter,
        config,
        poll,
        ata,
        receipt,
        classic_token_program(),
        0,
    );
    assert_anchor_error(res, ErrorCode::PollNotOpen);
}

#[test]
fn cast_vote_rejects_after_end() {
    let (mut svm, program_id) = setup_svm();
    let authority = Keypair::new();
    let (config, mint) = initialized(&mut svm, &program_id, &authority);
    let poll = open_poll(&mut svm, &program_id, &authority, config);

    let voter = Keypair::new();
    fund_voter(&mut svm, &voter);
    let ata = insert_ata(&mut svm, voter.pubkey(), mint, classic_token_program(), 1);
    let (receipt, _) = vote_pda(&program_id, &poll, &voter.pubkey());

    set_clock(&mut svm, TEST_NOW + 3_601);
    let res = send_vote(
        &mut svm,
        &voter,
        config,
        poll,
        ata,
        receipt,
        classic_token_program(),
        0,
    );
    assert_anchor_error(res, ErrorCode::PollNotOpen);
}

#[test]
fn cast_vote_rejects_closed_poll() {
    let (mut svm, program_id) = setup_svm();
    let authority = Keypair::new();
    let (config, mint) = initialized(&mut svm, &program_id, &authority);
    let poll = open_poll(&mut svm, &program_id, &authority, config);
    set_poll_closed(&mut svm, poll);

    let voter = Keypair::new();
    fund_voter(&mut svm, &voter);
    let ata = insert_ata(&mut svm, voter.pubkey(), mint, classic_token_program(), 1);
    let (receipt, _) = vote_pda(&program_id, &poll, &voter.pubkey());

    let res = send_vote(
        &mut svm,
        &voter,
        config,
        poll,
        ata,
        receipt,
        classic_token_program(),
        0,
    );
    assert_anchor_error(res, ErrorCode::PollClosed);
}

#[test]
fn cast_vote_rejects_second_vote() {
    let (mut svm, program_id) = setup_svm();
    let authority = Keypair::new();
    let (config, mint) = initialized(&mut svm, &program_id, &authority);
    let poll = open_poll(&mut svm, &program_id, &authority, config);

    let voter = Keypair::new();
    fund_voter(&mut svm, &voter);
    let ata = insert_ata(&mut svm, voter.pubkey(), mint, classic_token_program(), 7);
    let (receipt, _) = vote_pda(&program_id, &poll, &voter.pubkey());

    send_vote(
        &mut svm,
        &voter,
        config,
        poll,
        ata,
        receipt,
        classic_token_program(),
        1,
    )
    .unwrap();

    let res = send_vote(
        &mut svm,
        &voter,
        config,
        poll,
        ata,
        receipt,
        classic_token_program(),
        0,
    );
    assert_instruction_failed_with_log(res, "already in use");

    let mut data: &[u8] = &svm.get_account(&receipt).unwrap().data;
    let receipt_state = ledger_vote::state::VoteReceipt::try_deserialize(&mut data).unwrap();
    assert_eq!(receipt_state.choice, 1);
    assert_eq!(receipt_state.weight, 7u64.isqrt());
}

#[test]
fn cast_vote_allows_exactly_end_ts() {
    let (mut svm, program_id) = setup_svm();
    let authority = Keypair::new();
    let (config, mint) = initialized(&mut svm, &program_id, &authority);
    let poll = open_poll(&mut svm, &program_id, &authority, config);

    let voter = Keypair::new();
    fund_voter(&mut svm, &voter);
    let ata = insert_ata(&mut svm, voter.pubkey(), mint, classic_token_program(), 1);
    let (receipt, _) = vote_pda(&program_id, &poll, &voter.pubkey());

    set_clock(&mut svm, TEST_NOW + 3_600);
    let res = send_vote(
        &mut svm,
        &voter,
        config,
        poll,
        ata,
        receipt,
        classic_token_program(),
        0,
    );
    assert!(res.is_ok(), "vote at end_ts should succeed: {res:?}");
}

#[test]
fn cast_vote_rejects_wrong_mint_ata() {
    let (mut svm, program_id) = setup_svm();
    let authority = Keypair::new();
    let (config, _mint) = initialized(&mut svm, &program_id, &authority);
    let poll = open_poll(&mut svm, &program_id, &authority, config);
    let token = classic_token_program();

    let voter = Keypair::new();
    fund_voter(&mut svm, &voter);
    let other_mint = Pubkey::new_unique();
    insert_mint(&mut svm, other_mint, voter.pubkey(), token);
    let wrong_ata = insert_ata(&mut svm, voter.pubkey(), other_mint, token, 100);
    let (receipt, _) = vote_pda(&program_id, &poll, &voter.pubkey());

    let res = send_vote(&mut svm, &voter, config, poll, wrong_ata, receipt, token, 0);
    assert!(res.is_err(), "wrong mint ATA should fail: {res:?}");
    assert!(
        svm.get_account(&receipt).is_none(),
        "failed vote must not create a receipt"
    );
}

#[test]
fn cast_vote_rejects_non_ata_token_account() {
    let (mut svm, program_id) = setup_svm();
    let authority = Keypair::new();
    let (config, mint) = initialized(&mut svm, &program_id, &authority);
    let poll = open_poll(&mut svm, &program_id, &authority, config);
    let token = classic_token_program();

    let voter = Keypair::new();
    fund_voter(&mut svm, &voter);
    let not_ata = Keypair::new().pubkey();
    insert_token_account(&mut svm, not_ata, voter.pubkey(), mint, token, 100);
    let (receipt, _) = vote_pda(&program_id, &poll, &voter.pubkey());

    let res = send_vote(&mut svm, &voter, config, poll, not_ata, receipt, token, 0);
    assert!(res.is_err(), "non-ATA token account should fail: {res:?}");
    assert!(
        svm.get_account(&receipt).is_none(),
        "failed vote must not create a receipt"
    );
}
