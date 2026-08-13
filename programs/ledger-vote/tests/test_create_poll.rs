mod common;

use {
    anchor_lang::{prelude::Pubkey, AccountDeserialize},
    solana_keypair::Keypair,
    solana_signer::Signer,
};

use common::{create_poll_ix, initialized, poll_pda, send_ix, set_clock, setup_svm, TEST_NOW};

fn two_options() -> Vec<String> {
    vec!["yes".into(), "no".into()]
}

fn valid_window() -> (i64, i64) {
    (TEST_NOW, TEST_NOW + 3_600)
}

#[test]
fn create_poll_happy_path() {
    let (mut svm, program_id) = setup_svm();
    let payer = Keypair::new();
    let (config, _) = initialized(&mut svm, &program_id, &payer);
    let (poll, bump) = poll_pda(&program_id, 0);
    let (start_ts, end_ts) = valid_window();

    let res = send_ix(
        &mut svm,
        &payer,
        create_poll_ix(
            payer.pubkey(),
            config,
            poll,
            "best color".into(),
            two_options(),
            start_ts,
            end_ts,
        ),
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
    assert!(poll_state.question.starts_with(b"best color"));
    assert!(poll_state.options[0].starts_with(b"yes"));
    assert!(poll_state.options[1].starts_with(b"no"));

    let mut data: &[u8] = &svm.get_account(&config).unwrap().data;
    let config_state = ledger_vote::state::Config::try_deserialize(&mut data).unwrap();
    assert_eq!(config_state.poll_count, 1);
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
    assert!(res.is_err(), "unauthorized create_poll should fail");
}

#[test]
fn create_poll_rejects_bad_option_count() {
    let (mut svm, program_id) = setup_svm();
    let payer = Keypair::new();
    let (config, _) = initialized(&mut svm, &program_id, &payer);
    let (poll, _) = poll_pda(&program_id, 0);
    let (start_ts, end_ts) = valid_window();

    let res = send_ix(
        &mut svm,
        &payer,
        create_poll_ix(
            payer.pubkey(),
            config,
            poll,
            "best color".into(),
            vec!["only-one".into()],
            start_ts,
            end_ts,
        ),
    );
    assert!(res.is_err(), "single option should fail");
}

#[test]
fn create_poll_rejects_invalid_window() {
    let (mut svm, program_id) = setup_svm();
    let payer = Keypair::new();
    let (config, _) = initialized(&mut svm, &program_id, &payer);
    let (poll, _) = poll_pda(&program_id, 0);

    let ended = send_ix(
        &mut svm,
        &payer,
        create_poll_ix(
            payer.pubkey(),
            config,
            poll,
            "best color".into(),
            two_options(),
            TEST_NOW - 100,
            TEST_NOW,
        ),
    );
    assert!(ended.is_err(), "end_ts == now should fail");

    set_clock(&mut svm, TEST_NOW);
    let inverted = send_ix(
        &mut svm,
        &payer,
        create_poll_ix(
            payer.pubkey(),
            config,
            poll,
            "best color".into(),
            two_options(),
            TEST_NOW + 100,
            TEST_NOW + 50,
        ),
    );
    assert!(inverted.is_err(), "start >= end should fail");
}
