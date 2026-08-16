import type { Address, Instruction, TransactionSigner } from "@solana/kit";
import {
  ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
  getCreateAssociatedTokenIdempotentInstructionAsync,
} from "@solana-program/token";

export async function getCreateVoterAtaInstruction(input: {
  payer: TransactionSigner;
  owner: Address;
  mint: Address;
  tokenProgram: Address;
}): Promise<Instruction> {
  return getCreateAssociatedTokenIdempotentInstructionAsync({
    payer: input.payer,
    owner: input.owner,
    mint: input.mint,
    tokenProgram: input.tokenProgram,
  });
}

export { ASSOCIATED_TOKEN_PROGRAM_ADDRESS };
