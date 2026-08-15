use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("Only the config authority can perform this action")]
    Unauthorized,
    #[msg("A poll must have between 2 and 4 options")]
    InvalidOptionCount,
    #[msg("Each option must be non-empty and at most 32 bytes")]
    InvalidOption,
    #[msg("Question must be non-empty and at most 64 bytes")]
    InvalidQuestion,
    #[msg("Poll window is invalid: start must be before end, and end must be in the future")]
    InvalidWindow,
    #[msg("This poll is closed")]
    PollClosed,
    #[msg("This poll is not currently open for voting")]
    PollNotOpen,
    #[msg("Choice index is out of range for this poll")]
    InvalidChoice,
    #[msg("Vote weight is zero; the voter ATA must hold the vote mint")]
    ZeroVoteWeight,
    #[msg("Tally overflow")]
    TallyOverflow,
    #[msg("Poll count overflow")]
    PollCountOverflow,
    #[msg("Vote mint freeze authority must be the Config PDA")]
    MintFreezeRequired,
    #[msg("token_program must own the vote mint")]
    MintTokenProgramMismatch,
    #[msg("Cannot thaw while this poll is still open")]
    PollStillOpen,
    #[msg("Voter ATA is not frozen")]
    AccountNotFrozen,
}
