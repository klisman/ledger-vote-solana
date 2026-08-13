mod common;

use {
    anchor_lang::{prelude::Pubkey, AccountDeserialize},
    solana_keypair::Keypair,
    solana_signer::Signer,
};

use common::{initialize_ix, insert_mint, send_ix, setup_svm};

#[test]
fn test_initialize() {
    let (mut svm, program_id) = setup_svm();
    let payer = Keypair::new();
    svm.airdrop(&payer.pubkey(), 1_000_000_000).unwrap();

    let vote_mint = Pubkey::new_unique();
    insert_mint(&mut svm, vote_mint, payer.pubkey());

    let (config, bump) =
        Pubkey::find_program_address(&[ledger_vote::constants::CONFIG_SEED], &program_id);

    let res = send_ix(
        &mut svm,
        &payer,
        initialize_ix(payer.pubkey(), config, vote_mint),
    );
    assert!(res.is_ok(), "initialize failed: {res:?}");

    let config_account = svm.get_account(&config).expect("config PDA should exist");
    let mut data: &[u8] = &config_account.data;
    let config_state = ledger_vote::state::Config::try_deserialize(&mut data).unwrap();
    assert_eq!(config_state.authority, payer.pubkey());
    assert_eq!(config_state.vote_mint, vote_mint);
    assert_eq!(config_state.poll_count, 0);
    assert_eq!(config_state.bump, bump);
}
