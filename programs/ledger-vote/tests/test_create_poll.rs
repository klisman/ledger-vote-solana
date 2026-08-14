#[path = "common/harness.rs"]
mod harness;
#[path = "common/poll.rs"]
mod poll;

use {
    anchor_lang::{prelude::Pubkey, AccountDeserialize},
    litesvm::{types::TransactionResult, LiteSVM},
    solana_keypair::Keypair,
    solana_signer::Signer,
};

use harness::{send_ix, setup_svm};
use ledger_vote::{
    constants::{MAX_OPTION_LEN, MAX_QUESTION_LEN},
    error::ErrorCode,
};
use poll::{assert_anchor_error, create_poll_ix, initialized, poll_pda, set_clock, TEST_NOW};

fn two_options() -> Vec<String> {
    vec!["yes".into(), "no".into()]
}

fn valid_window() -> (i64, i64) {
    (TEST_NOW, TEST_NOW + 3_600)
}

fn pad<const N: usize>(s: &str) -> [u8; N] {
    let mut out = [0u8; N];
    out[..s.len()].copy_from_slice(s.as_bytes());
    out
}

fn send_create(
    svm: &mut LiteSVM,
    payer: &Keypair,
    config: Pubkey,
    poll: Pubkey,
    question: String,
    options: Vec<String>,
    start_ts: i64,
    end_ts: i64,
) -> TransactionResult {
    send_ix(
        svm,
        payer,
        create_poll_ix(
            payer.pubkey(),
            config,
            poll,
            question,
            options,
            start_ts,
            end_ts,
        ),
    )
}

#[test]
fn create_poll_happy_path() {
    let (mut svm, program_id) = setup_svm();
    let payer = Keypair::new();
    let (config, _) = initialized(&mut svm, &program_id, &payer);
    let (poll, bump) = poll_pda(&program_id, 0);
    let (start_ts, end_ts) = valid_window();

    let res = send_create(
        &mut svm,
        &payer,
        config,
        poll,
        "best color".into(),
        two_options(),
        start_ts,
        end_ts,
    );
    assert!(res.is_ok(), "create_poll failed: {res:?}");

    let mut data: &[u8] = &svm.get_account(&poll).unwrap().data;
    let poll_state = ledger_vote::state::Poll::try_deserialize(&mut data).unwrap();
    assert_eq!(poll_state.id, 0);
    assert_eq!(poll_state.authority, payer.pubkey());
    assert_eq!(poll_state.bump, bump);
    assert_eq!(poll_state.option_count, 2);
    assert_eq!(poll_state.start_ts, start_ts);
    assert_eq!(poll_state.end_ts, end_ts);
    assert!(!poll_state.closed);
    assert_eq!(poll_state.tallies, [0; 4]);
    assert_eq!(poll_state.question, pad::<MAX_QUESTION_LEN>("best color"));
    assert_eq!(poll_state.options[0], pad::<MAX_OPTION_LEN>("yes"));
    assert_eq!(poll_state.options[1], pad::<MAX_OPTION_LEN>("no"));
    assert_eq!(poll_state.options[2], [0u8; MAX_OPTION_LEN]);
    assert_eq!(poll_state.options[3], [0u8; MAX_OPTION_LEN]);

    let mut data: &[u8] = &svm.get_account(&config).unwrap().data;
    let config_state = ledger_vote::state::Config::try_deserialize(&mut data).unwrap();
    assert_eq!(config_state.poll_count, 1);
}

#[test]
fn create_poll_second_poll_uses_incremented_id() {
    let (mut svm, program_id) = setup_svm();
    let payer = Keypair::new();
    let (config, _) = initialized(&mut svm, &program_id, &payer);
    let (start_ts, end_ts) = valid_window();

    let (poll0, _) = poll_pda(&program_id, 0);
    send_create(
        &mut svm,
        &payer,
        config,
        poll0,
        "first".into(),
        two_options(),
        start_ts,
        end_ts,
    )
    .unwrap();

    let (poll1, bump1) = poll_pda(&program_id, 1);
    let res = send_create(
        &mut svm,
        &payer,
        config,
        poll1,
        "second".into(),
        vec!["red".into(), "blue".into(), "green".into()],
        start_ts,
        end_ts,
    );
    assert!(res.is_ok(), "second create_poll failed: {res:?}");

    let mut data: &[u8] = &svm.get_account(&poll1).unwrap().data;
    let poll_state = ledger_vote::state::Poll::try_deserialize(&mut data).unwrap();
    assert_eq!(poll_state.id, 1);
    assert_eq!(poll_state.bump, bump1);
    assert_eq!(poll_state.option_count, 3);
    assert_eq!(poll_state.question, pad::<MAX_QUESTION_LEN>("second"));
    assert_eq!(poll_state.options[0], pad::<MAX_OPTION_LEN>("red"));
    assert_eq!(poll_state.options[1], pad::<MAX_OPTION_LEN>("blue"));
    assert_eq!(poll_state.options[2], pad::<MAX_OPTION_LEN>("green"));
    assert_eq!(poll_state.options[3], [0u8; MAX_OPTION_LEN]);

    let mut data: &[u8] = &svm.get_account(&config).unwrap().data;
    let config_state = ledger_vote::state::Config::try_deserialize(&mut data).unwrap();
    assert_eq!(config_state.poll_count, 2);
}

#[test]
fn create_poll_rejects_unauthorized() {
    let (mut svm, program_id) = setup_svm();
    let payer = Keypair::new();
    let (config, _) = initialized(&mut svm, &program_id, &payer);
    let stranger = Keypair::new();
    svm.airdrop(&stranger.pubkey(), 1_000_000_000).unwrap();
    let (poll, _) = poll_pda(&program_id, 0);
    let (start_ts, end_ts) = valid_window();

    let res = send_ix(
        &mut svm,
        &stranger,
        create_poll_ix(
            stranger.pubkey(),
            config,
            poll,
            "best color".into(),
            two_options(),
            start_ts,
            end_ts,
        ),
    );
    assert_anchor_error(res, ErrorCode::Unauthorized);
}

#[test]
fn create_poll_rejects_bad_option_count() {
    let (mut svm, program_id) = setup_svm();
    let payer = Keypair::new();
    let (config, _) = initialized(&mut svm, &program_id, &payer);
    let (poll, _) = poll_pda(&program_id, 0);
    let (start_ts, end_ts) = valid_window();

    let one = send_create(
        &mut svm,
        &payer,
        config,
        poll,
        "best color".into(),
        vec!["only-one".into()],
        start_ts,
        end_ts,
    );
    assert_anchor_error(one, ErrorCode::InvalidOptionCount);

    let five = send_create(
        &mut svm,
        &payer,
        config,
        poll,
        "best color".into(),
        vec!["a".into(), "b".into(), "c".into(), "d".into(), "e".into()],
        start_ts,
        end_ts,
    );
    assert_anchor_error(five, ErrorCode::InvalidOptionCount);
}

#[test]
fn create_poll_rejects_invalid_question() {
    let (mut svm, program_id) = setup_svm();
    let payer = Keypair::new();
    let (config, _) = initialized(&mut svm, &program_id, &payer);
    let (poll, _) = poll_pda(&program_id, 0);
    let (start_ts, end_ts) = valid_window();

    let empty = send_create(
        &mut svm,
        &payer,
        config,
        poll,
        String::new(),
        two_options(),
        start_ts,
        end_ts,
    );
    assert_anchor_error(empty, ErrorCode::InvalidQuestion);

    let too_long = send_create(
        &mut svm,
        &payer,
        config,
        poll,
        "q".repeat(MAX_QUESTION_LEN + 1),
        two_options(),
        start_ts,
        end_ts,
    );
    assert_anchor_error(too_long, ErrorCode::InvalidQuestion);
}

#[test]
fn create_poll_rejects_invalid_option() {
    let (mut svm, program_id) = setup_svm();
    let payer = Keypair::new();
    let (config, _) = initialized(&mut svm, &program_id, &payer);
    let (poll, _) = poll_pda(&program_id, 0);
    let (start_ts, end_ts) = valid_window();

    let empty = send_create(
        &mut svm,
        &payer,
        config,
        poll,
        "best color".into(),
        vec!["yes".into(), "".into()],
        start_ts,
        end_ts,
    );
    assert_anchor_error(empty, ErrorCode::InvalidOption);

    let too_long = send_create(
        &mut svm,
        &payer,
        config,
        poll,
        "best color".into(),
        vec!["yes".into(), "x".repeat(MAX_OPTION_LEN + 1)],
        start_ts,
        end_ts,
    );
    assert_anchor_error(too_long, ErrorCode::InvalidOption);
}

#[test]
fn create_poll_rejects_invalid_window() {
    let (mut svm, program_id) = setup_svm();
    let payer = Keypair::new();
    let (config, _) = initialized(&mut svm, &program_id, &payer);
    let (poll, _) = poll_pda(&program_id, 0);

    let ended = send_create(
        &mut svm,
        &payer,
        config,
        poll,
        "best color".into(),
        two_options(),
        TEST_NOW - 100,
        TEST_NOW,
    );
    assert_anchor_error(ended, ErrorCode::InvalidWindow);

    set_clock(&mut svm, TEST_NOW);
    let inverted = send_create(
        &mut svm,
        &payer,
        config,
        poll,
        "best color".into(),
        two_options(),
        TEST_NOW + 100,
        TEST_NOW + 50,
    );
    assert_anchor_error(inverted, ErrorCode::InvalidWindow);
}
