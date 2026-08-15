#[path = "common/close.rs"]
mod close;
#[path = "common/harness.rs"]
mod harness;
#[path = "common/poll.rs"]
mod poll;
#[path = "common/vote.rs"]
mod vote;

use solana_keypair::Keypair;
use solana_signer::Signer;

use close::send_close;
use harness::{send_ix, setup_svm};
use ledger_vote::error::ErrorCode;
use poll::{assert_anchor_error, initialized};
use vote::{
    ata_is_frozen, classic_token_program, insert_ata, open_poll, send_thaw, send_vote, transfer_ix,
    vote_pda,
};

fn fund_voter(svm: &mut litesvm::LiteSVM, voter: &Keypair) {
    svm.airdrop(&voter.pubkey(), 1_000_000_000).unwrap();
}

#[test]
fn freeze_blocks_transfer_of_the_same_pile() {
    let (mut svm, program_id) = setup_svm();
    let authority = Keypair::new();
    let (config, mint) = initialized(&mut svm, &program_id, &authority);
    let poll = open_poll(&mut svm, &program_id, &authority, config);
    let token = classic_token_program();

    let a = Keypair::new();
    let b = Keypair::new();
    fund_voter(&mut svm, &a);
    fund_voter(&mut svm, &b);
    let ata_a = insert_ata(&mut svm, a.pubkey(), mint, token, 1_000_000);
    let ata_b = insert_ata(&mut svm, b.pubkey(), mint, token, 0);
    let (receipt_a, _) = vote_pda(&program_id, &poll, &a.pubkey());

    send_vote(&mut svm, &a, config, poll, mint, ata_a, receipt_a, token, 0).unwrap();
    assert!(ata_is_frozen(&svm, ata_a));

    let res = send_ix(
        &mut svm,
        &a,
        transfer_ix(token, ata_a, ata_b, a.pubkey(), 1_000_000),
    );
    assert!(res.is_err(), "frozen ATA must not transfer: {res:?}");
}

#[test]
fn thaw_rejected_while_poll_open() {
    let (mut svm, program_id) = setup_svm();
    let authority = Keypair::new();
    let (config, mint) = initialized(&mut svm, &program_id, &authority);
    let poll = open_poll(&mut svm, &program_id, &authority, config);
    let token = classic_token_program();

    let voter = Keypair::new();
    fund_voter(&mut svm, &voter);
    let ata = insert_ata(&mut svm, voter.pubkey(), mint, token, 9);
    let (receipt, _) = vote_pda(&program_id, &poll, &voter.pubkey());
    send_vote(
        &mut svm,
        &voter,
        config,
        poll,
        mint,
        ata,
        receipt,
        token,
        0,
    )
    .unwrap();

    let res = send_thaw(
        &mut svm,
        &voter,
        config,
        poll,
        mint,
        ata,
        receipt,
        token,
    );
    assert_anchor_error(res, ErrorCode::PollStillOpen);
    assert!(ata_is_frozen(&svm, ata));
}

#[test]
fn thaw_after_close_allows_transfer() {
    let (mut svm, program_id) = setup_svm();
    let authority = Keypair::new();
    let (config, mint) = initialized(&mut svm, &program_id, &authority);
    let poll = open_poll(&mut svm, &program_id, &authority, config);
    let token = classic_token_program();

    let a = Keypair::new();
    let b = Keypair::new();
    fund_voter(&mut svm, &a);
    fund_voter(&mut svm, &b);
    let ata_a = insert_ata(&mut svm, a.pubkey(), mint, token, 100);
    let ata_b = insert_ata(&mut svm, b.pubkey(), mint, token, 0);
    let (receipt, _) = vote_pda(&program_id, &poll, &a.pubkey());
    send_vote(&mut svm, &a, config, poll, mint, ata_a, receipt, token, 0).unwrap();
    send_close(&mut svm, &authority, config, poll).unwrap();

    send_thaw(&mut svm, &a, config, poll, mint, ata_a, receipt, token).unwrap();
    assert!(!ata_is_frozen(&svm, ata_a));

    send_ix(
        &mut svm,
        &a,
        transfer_ix(token, ata_a, ata_b, a.pubkey(), 100),
    )
    .unwrap();
}
