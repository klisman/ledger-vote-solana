use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("Only the config authority can perform this action")]
    Unauthorized,
}
