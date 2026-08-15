import { getAddressEncoder, getProgramDerivedAddress, type Address } from "@solana/kit";
import { u64le } from "@/lib/bytes";

const utf8 = new TextEncoder();

export async function configPda(programId: Address) {
  return getProgramDerivedAddress({
    programAddress: programId,
    seeds: [utf8.encode("config")],
  });
}

export async function pollPda(programId: Address, pollId: bigint) {
  return getProgramDerivedAddress({
    programAddress: programId,
    seeds: [utf8.encode("poll"), u64le(pollId)],
  });
}

export async function votePda(
  programId: Address,
  poll: Address,
  voter: Address,
) {
  const addresses = getAddressEncoder();
  return getProgramDerivedAddress({
    programAddress: programId,
    seeds: [utf8.encode("vote"), addresses.encode(poll), addresses.encode(voter)],
  });
}
