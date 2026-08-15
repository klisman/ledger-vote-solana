#[path = "common/close.rs"]
mod close;
#[path = "common/harness.rs"]
mod harness;
#[path = "common/poll.rs"]
mod poll;
#[path = "common/vote.rs"]
mod vote;

use {anchor_lang::AccountDeserialize, solana_keypair::Keypair, solana_signer::Signer};

use close::{close_poll_ix, send_close};
use harness::{send_ix, setup_svm};
use ledger_vote::error::ErrorCode;
use poll::{assert_anchor_error, initialized};
use vote::{classic_token_program, insert_ata, open_poll, send_vote, vote_pda};

fn fund_voter(svm: &mut litesvm::LiteSVM, voter: &Keypair) {
    svm.airdrop(&voter.pubkey(), 1_000_000_000).unwrap();
}

#[test]
fn close_poll_happy_path() {
    let (mut svm, program_id) = setup_svm();
    let authority = Keypair::new();
    let (config, _) = initialized(&mut svm, &program_id, &authority);
    let poll = open_poll(&mut svm, &program_id, &authority, config);

    let res = send_close(&mut svm, &authority, config, poll);
    assert!(res.is_ok(), "close_poll failed: {res:?}");

    let mut data: &[u8] = &svm.get_account(&poll).unwrap().data;
    let poll_state = ledger_vote::state::Poll::try_deserialize(&mut data).unwrap();
    assert!(poll_state.closed);
    assert_eq!(poll_state.tallies, [0; 4]);
}

#[test]
fn close_poll_preserves_tallies() {
    let (mut svm, program_id) = setup_svm();
    let authority = Keypair::new();
    let (config, mint) = initialized(&mut svm, &program_id, &authority);
    let poll = open_poll(&mut svm, &program_id, &authority, config);
    let token = classic_token_program();

    let voter = Keypair::new();
    fund_voter(&mut svm, &voter);
    let amount: u64 = 100;
    let ata = insert_ata(&mut svm, voter.pubkey(), mint, token, amount);
    let (receipt, _) = vote_pda(&program_id, &poll, &voter.pubkey());
    send_vote(&mut svm, &voter, config, poll, ata, receipt, token, 1).unwrap();

    send_close(&mut svm, &authority, config, poll).unwrap();

    let mut data: &[u8] = &svm.get_account(&poll).unwrap().data;
    let poll_state = ledger_vote::state::Poll::try_deserialize(&mut data).unwrap();
    assert!(poll_state.closed);
    assert_eq!(poll_state.tallies, [0, amount.isqrt(), 0, 0]);
}

#[test]
fn close_poll_rejects_unauthorized() {
    let (mut svm, program_id) = setup_svm();
    let authority = Keypair::new();
    let (config, _) = initialized(&mut svm, &program_id, &authority);
    let poll = open_poll(&mut svm, &program_id, &authority, config);

    let stranger = Keypair::new();
    svm.airdrop(&stranger.pubkey(), 1_000_000_000).unwrap();
    let res = send_ix(
        &mut svm,
        &stranger,
        close_poll_ix(stranger.pubkey(), config, poll),
    );
    assert_anchor_error(res, ErrorCode::Unauthorized);

    let mut data: &[u8] = &svm.get_account(&poll).unwrap().data;
    let poll_state = ledger_vote::state::Poll::try_deserialize(&mut data).unwrap();
    assert!(!poll_state.closed);
}

#[test]
fn close_poll_rejects_already_closed() {
    let (mut svm, program_id) = setup_svm();
    let authority = Keypair::new();
    let (config, _) = initialized(&mut svm, &program_id, &authority);
    let poll = open_poll(&mut svm, &program_id, &authority, config);

    send_close(&mut svm, &authority, config, poll).unwrap();
    // Same accounts and empty args would reuse the signature unless the blockhash rotates.
    svm.expire_blockhash();
    let res = send_close(&mut svm, &authority, config, poll);
    assert_anchor_error(res, ErrorCode::PollClosed);
}

#[test]
fn close_poll_then_cast_vote_fails() {
    let (mut svm, program_id) = setup_svm();
    let authority = Keypair::new();
    let (config, mint) = initialized(&mut svm, &program_id, &authority);
    let poll = open_poll(&mut svm, &program_id, &authority, config);
    send_close(&mut svm, &authority, config, poll).unwrap();

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
    assert!(
        svm.get_account(&receipt).is_none(),
        "closed poll must not create a receipt"
    );
}
