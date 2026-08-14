use anchor_lang::prelude::*;

use crate::error::ErrorCode;

/// Voting power from a raw ATA amount: `floor(sqrt(amount))`.
///
/// Tokens still add weight, but extra balance buys diminishing tally units so a
/// whale cannot linearly outvote everyone else.
pub fn vote_weight(ata_amount: u64) -> Result<u64> {
    require!(ata_amount > 0, ErrorCode::ZeroVoteWeight);
    Ok(ata_amount.isqrt())
}

#[cfg(test)]
mod tests {
    use super::*;
    use anchor_lang::error::Error;

    #[test]
    fn sqrt_keeps_weight_but_dampens_whales() {
        assert_eq!(vote_weight(1).unwrap(), 1);
        assert_eq!(vote_weight(100).unwrap(), 10);
        assert_eq!(vote_weight(1_000_000).unwrap(), 1_000);
        assert_eq!(vote_weight(42).unwrap(), 6);
        assert!(vote_weight(1_000_000).unwrap() < 1_000_000);
    }

    #[test]
    fn zero_amount_is_zero_vote_weight() {
        match vote_weight(0) {
            Err(Error::AnchorError(err)) => {
                assert_eq!(err.error_code_number, u32::from(ErrorCode::ZeroVoteWeight));
                assert_eq!(err.error_name, "ZeroVoteWeight");
            }
            other => panic!("expected ZeroVoteWeight, got {other:?}"),
        }
    }
}
